# Theater Inventory Tracker — Design Decisions

This file records the settled technical decisions for the MVP and the resolutions applied where
`references/Theater_Inventory_Tracker_IA_v3.xlsm` and the documents in `/docs` disagreed.

Approved by the project owner. Do not reverse any entry here without an explicit new decision.

## 1. Document Authority

`Theater_Inventory_Tracker_IA_v3.xlsm` is the current source for user-facing features and flows —
pages, contents, components, purposes. This file is the current source for technical structure —
data shapes, permission model, and backend design. Where the two disagreed, the decisions below
resolved the conflict and `/docs` was updated to match.

## 2. Permission Storage

Permissions live inside `organization_memberships`:

- `team_ids: string[]`
- `permissions: ModulePermissions`

There is no separate `team_permissions` collection and no per-team permission document. Every
authorization decision resolves from a single membership read, in the client and in Security
Rules alike.

## 3. Permission Modules

The MVP has exactly four:

- `inventory`
- `maintenance`
- `productions`
- `calendar`

Each takes `none`, `view`, or `edit`.

**Dashboard has no permission.** Each summary card renders only when its underlying module is
viewable. A member with no viewable module sees an empty-state dashboard.

**Action List has no permission.** It follows `productions`, because an action item exists only as
the resolution of a production requirement.

## 4. Organization Join Code

The join code is never stored on the organization document. Firestore cannot restrict reads at
field level, and every member — including `unassigned` members — must read that document for the
organization name.

The code lives in `organization_join_codes/{code}` with the normalized code as the document ID.
That is also what guarantees uniqueness, since Firestore cannot enforce it on a field.

## 5. Privileged Operations

Four callable Cloud Functions, on the Blaze plan:

- `createOrganization`
- `joinOrganizationByCode`
- `regenerateOrganizationCode`
- `transferAdmin`

The project owner is notified before the step that requires Firebase billing to be configured.

## 6. Team Scope

**Team-scoped** — editing requires the record's team to be one of the user's teams:

- `inventory_items`
- `maintenance_records`
- `production_requirements`
- `action_items`

**Organization-level** — the module permission alone decides:

- `productions`
- `calendar_events`
- `teams`

## 7. Maintenance Team Denormalization

`maintenance_records.team_id` is copied from the linked inventory item at creation. Security Rules
evaluate team scope from the record itself rather than joining back to `inventory_items` on every
write.

## 8. AI Never Produces Document IDs

**AI Smart Search** returns `team_name`; the application resolves the real `team_id`.

**AI Requirement Generator** returns `inventory_match_keyword` and `suggested_team_name`; the
application resolves the real IDs.

A model-produced ID would be a fabricated record reference and could point outside the active
organization.

## 9. Search Conditions

`conditions` is always an array, so queries such as "damaged or unusable" are expressible.

## 10. Action Items

At most one per production requirement. The document ID **is** the `requirement_id`, which is what
structurally prevents duplicates.

Created or updated only after the user chooses a shortage action type. Never created for a Not
Matched requirement, a zero shortage, or an Already Available state.

`already_available` is not an action type — it is the derived state of a requirement whose
shortage is zero.

## 11. Role Promotion — the Assignment Condition

A membership satisfies the **assignment condition** when both hold:

- `team_ids` contains at least one team, **and**
- at least one of the four module permissions is `view` or `edit`.

A user joining by code is `unassigned`. When an Admin saves a membership that satisfies the
assignment condition, `role` becomes `member` automatically. When a saved membership no longer
satisfies it — every team removed, or every module returned to `none` — `role` returns to
`unassigned`. There is no manual role control for this transition.

The assignment condition is evaluated in exactly two places: on saving a membership, and on
completing a Transfer Admin (decision 24). It is one rule, not two.

## 12. Member Removal

No hard delete in the MVP. Removal sets `is_active = false`, preserving every `created_by_uid`,
`assignee_uid`, and `assigned_by_uid` reference the organization's history depends on.

## 13. Calendar Team Visibility

Events carry `team_ids: string[]` so one event can address several teams.

Team visibility is a **display filter, not a security boundary**. Anyone with `calendar` view
permission reads every event in the organization; Security Rules enforce organization scope and
permission level only.

## 14. Unlinked Requirements

A requirement with no `inventory_item_id` is **Not Matched**:

- `available_qty` is `null`, not `0`,
- no shortage is calculated,
- no action item may be created.

Treating it as zero availability would misreport a shortage the organization may not have.

## 15. Available Quantity

`quantity_available` is a manually maintained authoritative value. Nothing writes to it
automatically.

The quantity currently in service is derived by summing `quantity_sent` across maintenance records
whose status is `sent`, `in_service`, or `ready`. It is displayed **beside** available quantity,
never subtracted from it.

## 16. Approved Dependencies

- Zod — runtime validation of AI output
- Vitest — unit tests for domain logic
- @firebase/rules-unit-testing with the Firebase Emulator Suite — Security Rules tests

## 17. Excluded From the MVP

QR scanning, item photos, checkout/check-in, notifications, analytics, recurring calendar events,
hard deletion of members/items/teams, and per-production inventory allocation.

## 18. Derived Values Are Not Stored

Shortage quantity, condition summary, overdue state, requirement counts, and dashboard totals are
computed by application logic. The only sanctioned denormalizations are
`maintenance_records.team_id` and `organization_memberships.organization_name`.

## 19. Condition Summary Rule

The representative condition is the **worst state holding at least one unit**, in this order:

`unusable` > `needs_repair` > `fair` > `good` > `excellent`

When `condition_counts` sum to less than `quantity_total`, the remainder is displayed as
**Unclassified**. It is not assumed to belong to any bucket.

Derived in application logic, never stored in Firestore.

## 20. Join Code Access

- Members and Unassigned members cannot read the join code at all.
- Joining is possible only through `joinOrganizationByCode`.
- An Admin can read the current join code for their own organization.
- Only an Admin can call `regenerateOrganizationCode`.
- A client cannot `get` an arbitrary join-code document, so codes cannot be probed to discover
  organizations.

## 21. Calendar Date and Time

- `event_date` — required
- `start_time?` — optional, `HH:mm`
- `end_time?` — optional, `HH:mm`

An event with no times is an **all-day event**. Recurring events and timezone handling beyond the
organization's local time are not part of the MVP.

## 22. Action Item Quantity

`quantity` defaults to the shortage at the moment of creation and remains user-editable. The two
numbers mean different things and are displayed separately:

- **action item quantity** — how much work the user actually intends to do,
- **current shortage** — recomputed from live inventory every time it is displayed.

The action item quantity is never overwritten by a later shortage recalculation.

## 23. Admin Access Overrides the Permission Map

While `role === 'admin'`, the user has full access to the organization regardless of `team_ids`
and `permissions`. The membership's `team_ids` and `permissions` are **kept, not cleared**, when a
user becomes Admin; they are simply not consulted while the admin role is in effect.

## 24. Transfer Admin Outcome

Because a promoted Admin keeps their `team_ids` and `permissions` (decision 23), the outgoing
Admin already carries the data needed to determine their new role. `transferAdmin` therefore
resolves it by applying the assignment condition from decision 11:

- satisfies the assignment condition → `role = 'member'`
- does not satisfy it → `role = 'unassigned'`

The new Admin keeps their own `team_ids` and `permissions` unchanged; admin access takes
precedence while they hold the role.

The Transfer Admin screen builds **no additional UI** for configuring the outgoing Admin's teams
or permissions. If the outgoing Admin lands in `unassigned`, the existing Member Detail flow is
how an Admin assigns them again.

---

## IA v3 ↔ /docs Conflict Resolutions

| Topic | IA v3 | /docs (before) | Resolution |
|---|---|---|---|
| Permission storage | `team_permissions` collection, per (uid × org × team) | permission map on membership | Membership map (decision 2) |
| Permission modules | 4 (inventory, maintenance, production, calendar) | 6 (adds dashboard, action_list) | 4, with Dashboard and Action List following other modules (decision 3) |
| Membership state fields | `role` + `status` | `role` only | `role` only; two fields would drift |
| Member promotion | automatic on permission assignment | manual status change | Automatic (decision 11) |
| Join code location | field on `organizations` | `organization_join_codes` collection | Separate collection (decision 4) |
| Admin identity | `admin_uid` on `organizations` | derived from membership role | Derived from membership; no `admin_uid` field |
| Action item status | `open, in_progress, completed` | `todo, in_progress, done, cancelled` | `/docs` enum; IA v3 lacks a cancelled state its own rules require |
| Action item ID / fields | `action_id`, `quantity_needed` | `action_item_id`, `quantity` | `/docs` names; document ID is `requirement_id` |
| Action item creation | "automatically generated from shortages" | created when user picks action type | User-triggered (decision 10) |
| Calendar teams | `team_ids[]` | `visibility` + single `team_id` | `team_ids[]` (decision 13) |
| Calendar date/time | `event_date` + optional `start_time` / `end_time` | single `start_at` timestamp | IA v3 shape; a single timestamp cannot express a whole-day event |
| Calendar delete | delete button present | not mentioned | Delete allowed; events are not history records |
| Requirement availability | `available_qty`, `shortage_qty` stored | derived, not stored | Derived (decision 18) |
| Condition summary | `condition_summary` read as a field | derived for display | Derived (decision 18) |
| AI suggestion output | `team_id`, `inventory_item_id` | mixed across documents | Names and keywords only (decision 8) |
| AI search conditions | `condition` singular | `conditions` array | Array (decision 9) |
| Member removal | remove button | "if implemented" | Deactivation only (decision 12) |
| Transfer Admin scope | marked "(Optional)" in Settings, "MVP" on its own page | P0 | P0 — the spreadsheet contradicts itself |
| Item Detail repair history | marked "(optional)" | required | Required |

## Open Questions

None. The five decisions previously carried here as derived have been confirmed as decisions 19
through 22, admin access precedence as decision 23, and the Transfer Admin outcome — the one
question that was still open — as decision 24.
