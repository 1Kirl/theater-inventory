# Theater Inventory Tracker — Design Decisions

This file records the settled technical decisions for the MVP and the resolutions applied where
`references/Theater_Inventory_Tracker_IA_v3.xlsm` and the documents in `/docs` disagreed.

Approved by the project owner. Do not reverse any entry here without an explicit new decision.

---

## 0. Platform Constraint — Firebase Spark Plan Only

> **Firebase Spark plan only. Do not introduce Cloud Functions, Admin SDK, Cloud Run,
> Agent Platform Gemini API, or any feature that requires Blaze without explicit user approval.**

This constraint outranks every other entry in this file. When a design would need a paid Firebase
capability, stop and raise it rather than adopting it.

Consequences that shape the whole architecture:

- There is **no trusted server**. Every write originates in the browser.
- **Firestore Security Rules are the only authorization boundary.** They are not a second line of
  defence behind server code; they are the line.
- Multi-document consistency comes from **client-side transactions and batched writes**, validated
  in Rules with `getAfter()` and `existsAfter()`.
- AI runs through **Firebase AI Logic with the Gemini Developer API**, which has a Spark-compatible
  free tier. The Vertex AI / Agent Platform path is not used.

Decisions 25 through 32 record the architecture this produces. Decisions 5 and 20 are superseded by
it; decisions 4, 11, 23, and 24 are amended.

---

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

**Amended by decision 0.** Without a Cloud Function to validate codes server-side, the client must
read the code document directly. Access is therefore `get` for any signed-in user, `list` denied to
everyone. The code becomes a bearer secret and is sized accordingly. See decisions 28 and 29.

## 5. Privileged Operations — SUPERSEDED by decision 0

~~Four callable Cloud Functions, on the Blaze plan: `createOrganization`,
`joinOrganizationByCode`, `regenerateOrganizationCode`, `transferAdmin`.~~

Cloud Functions are not available on the Spark plan. These four operations are implemented in the
React client as Firestore transactions or batched writes, authorized entirely by Security Rules.
See decisions 30 through 32 for the flows and decision 33 for the Rules plan.

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

**Amended by decision 26.** `role` is no longer a stored field. The assignment condition is now
evaluated at runtime to derive the effective role, which produces the same user-visible behaviour
without a field that can drift from the data it summarizes.

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

## 20. Join Code Access — SUPERSEDED by decisions 28 and 29

~~Members and Unassigned members cannot read the join code at all. Joining is possible only through
`joinOrganizationByCode`. A client cannot `get` an arbitrary join-code document.~~

Without a Cloud Function, the joining client must read the code document itself. The replacement
policy keeps the property that matters — a member cannot discover their own organization's current
code — by moving that pointer into an Admin-only collection. See decisions 28 and 29.

What still holds:

- A member or Unassigned user cannot learn their organization's current join code.
- Only an Admin can regenerate a code.
- Nobody can enumerate codes or organizations.

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

While a user is Admin, they have full access to the organization regardless of `team_ids` and
`permissions`. Those fields are **kept, not cleared**; they are simply not consulted while the user
is Admin.

**Mechanism amended by decision 26.** Admin is now `organizations.admin_uid == uid` rather than a
stored `role`. The behaviour is identical, and preserving `team_ids` and `permissions` matters more
than before: they are the only input the effective-role computation has once administration moves
away.

## 24. Transfer Admin Outcome

Because a promoted Admin keeps their `team_ids` and `permissions` (decision 23), the outgoing
Admin already carries the data needed to determine their new role. `transferAdmin` therefore
resolves it by applying the assignment condition from decision 11:

- satisfies the assignment condition → reads as Member
- does not satisfy it → reads as Unassigned

The new Admin keeps their own `team_ids` and `permissions` unchanged; admin access takes
precedence while they hold the role.

**Mechanism amended by decision 26.** No membership is rewritten at all. The transfer writes
`organizations.admin_uid` and nothing else; both users' roles change because the computation reads a
different value, not because a field was updated on them.

The Transfer Admin screen builds **no additional UI** for configuring the outgoing Admin's teams
or permissions. If the outgoing Admin lands in `unassigned`, the existing Member Detail flow is
how an Admin assigns them again.

## 25. No Trusted Server

Organization operations run in the React client as Firestore transactions or batched writes.
Security Rules are the authorization boundary and the final source of truth. The Admin SDK is not
used anywhere in the project.

Two consequences follow, and both are load-bearing:

- Any invariant that must hold has to be expressible in Rules. If it cannot be, it is not enforced.
- Every multi-document operation must be atomic and validated as a unit with `getAfter()` /
  `existsAfter()`, because Rules evaluate each write in a batch independently.

## 26. Effective Role Is Computed, Never Stored

`organization_memberships` has no `role` field. The effective role is derived at runtime:

```
if organizations/{orgId}.admin_uid == uid
  -> Admin
else if membership.is_active == true
     && membership.team_ids.size() > 0
     && at least one of inventory/maintenance/productions/calendar is 'view' or 'edit'
  -> Member
else
  -> Unassigned
```

Administration is identified by a single field on the organization — `admin_uid` — rather than by a
role written onto a membership. That makes "exactly one Admin per organization" a structural
property instead of an invariant two documents have to agree on.

The user-visible behaviour is unchanged from decisions 11, 23, and 24:

- Admin has full access regardless of `team_ids` and `permissions`.
- Those fields are preserved while a user is Admin, because they are what the computation reads
  once administration moves away.
- After a transfer, the outgoing Admin becomes Member or Unassigned according to the same
  assignment condition — now evaluated, not written.

## 27. Organization and Membership Documents

`organizations/{orgId}`

| Field | Notes |
|---|---|
| `name` | |
| `admin_uid` | the single current Admin |
| `created_by_uid` | |
| `created_at`, `updated_at` | |

No join code and no member list live here.

`organization_memberships/{orgId}_{uid}`

| Field | Notes |
|---|---|
| `organization_id`, `uid` | must match the document ID |
| `team_ids[]` | |
| `permissions` | `inventory`, `maintenance`, `productions`, `calendar`, each `none`/`view`/`edit` |
| `is_active` | |
| `joined_at`, `updated_at` | |

No `role` field. The deterministic document ID makes a second membership for the same user in the
same organization impossible, which is also what prevents a deactivated member from re-joining with
a code: the create fails because the document already exists.

Hard delete is denied. Deactivation sets `is_active = false`. The current Admin's membership cannot
be deactivated; administration must be transferred first.

## 28. Join Code Format and Generation

`organization_join_codes/{code}`, with the normalized code as the document ID.

| Field | Notes |
|---|---|
| `organization_id` | |
| `organization_name_snapshot` | shown in the join preview |
| `active` | |
| `created_by_uid`, `created_at` | |
| `revoked_at` | set when superseded |

The code is **not** repeated as a field. The document ID is the canonical value; a second copy could
disagree with it.

Generation uses `crypto.getRandomValues()`. `Math.random()` is never used for a code.

- Alphabet: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — 32 characters, with `I`, `O`, `0`, and `1` removed
- Length: 16 characters, so 32^16 = 2^80 possible codes

Display may group the code as `K7PF-N4XQ-T3WM-H9RC`. The document ID is always the normalized form
with no hyphens. Input is trimmed, uppercased, and stripped of hyphens and whitespace before lookup.

Rules validate the shape of any code used as a path segment with `matches('^[A-HJ-NP-Z2-9]{16}$')`,
which is exactly this alphabet. Without that guard, a crafted `join_code_id` could alter the path a
Rules `get()` resolves to.

## 29. Join Code Is a Bearer Secret

`organization_join_codes/{code}`:

- `get` — any signed-in user. The joining client has to read the document, and there is no server
  to read it for them.
- `list` — denied to everyone, so codes and organizations cannot be enumerated.
- `create` / `update` — Admin of the referenced organization.
- `delete` — denied. Revoked codes are kept as history.

Holding a code is what proves a user may request membership. A code grants no operational access:
the membership it creates has no teams and no permissions.

`organization_admin_settings/{orgId}` keeps the pointer to the current code:

| Field | Notes |
|---|---|
| `organization_id` | |
| `current_join_code_id` | the active code |
| `updated_at` | |

`get` and `update` are Admin-only; `list` and `delete` are denied to everyone. This is what keeps
an ordinary member from learning their own organization's current code, which is the property the
superseded decision 20 protected by denying reads outright.

## 30. Join Proof

`organization_membership_join_proofs/{orgId}_{uid}`

| Field | Notes |
|---|---|
| `organization_id`, `uid` | must match the document ID |
| `join_code_id` | the code actually used |
| `created_at` | |

Its only purpose is to let Rules verify, inside the same atomic write, that a membership was
created with a real and active code for that organization. The membership document does not carry
the code, so an ordinary member reading a colleague's membership learns nothing about it.

- `get` — the subject or the Admin of that organization.
- `list` — denied to everyone.
- `create` — only as part of a valid join batch.
- `update` / `delete` — denied.

## 31. Create Organization — Client Batch

The client generates the organization ID and the join code, then commits one batch containing four
documents:

- `organizations/{orgId}` — `admin_uid` and `created_by_uid` both the caller
- `organization_memberships/{orgId}_{creatorUid}` — `team_ids: []`, all permissions `none`,
  `is_active: true`
- `organization_admin_settings/{orgId}` — `current_join_code_id` set to the new code
- `organization_join_codes/{code}` — `active: true`, `organization_id` matching

The creator's effective role is Admin because `admin_uid` names them, not because their membership
says so. Their empty membership is what they fall back to if administration is ever transferred
away.

Rules validate the batch as a unit: each write checks with `getAfter()` / `existsAfter()` that its
counterparts exist and agree after the commit. A partial or mismatched batch is rejected.

## 32. Join, Transfer, and Regenerate — Client Operations

**Join** — the client normalizes the code, does a single `get` on
`organization_join_codes/{code}`, checks `active == true`, shows
`organization_name_snapshot` for confirmation, then commits one batch:

- `organization_memberships/{orgId}_{uid}` — `team_ids: []`, all permissions `none`,
  `is_active: true`
- `organization_membership_join_proofs/{orgId}_{uid}` — naming the code used

Effective role is therefore Unassigned. An existing membership — active or not — makes the create
fail; a deactivated member is told to contact their Admin rather than being silently reactivated.

**Assignment** — only the Admin may change `team_ids`, `permissions`, or `is_active`. A member
cannot edit their own membership. Effective role is recomputed from the result.

**Transfer Admin** — a transaction reads the organization and the target membership, confirms the
caller is the current Admin and the target membership is active, and writes `admin_uid`. No
membership is rewritten, because no membership carries a role.

**Regenerate join code** — one batch: create the new code document, set the old one to
`active: false` with `revoked_at`, and repoint `organization_admin_settings.current_join_code_id`.
Old code documents are never deleted.

## 33. Security Rules Plan

Phase 1 `users` rules stand unchanged.

| Collection | get | list | create | update | delete |
|---|---|---|---|---|---|
| `organizations` | active member | denied | authenticated creator, `admin_uid == self`, valid batch | Admin, `admin_uid` transfer only | denied |
| `organization_memberships` | self, or active member of same org | self's own, or same-org active directory | org-creation batch or valid join batch | Admin only | denied |
| `organization_join_codes` | any signed-in user | denied | Admin of the org | Admin, revocation only | denied |
| `organization_admin_settings` | Admin | denied | org-creation batch | Admin | denied |
| `organization_membership_join_proofs` | self or Admin | denied | valid join batch | denied | denied |

**Rules are not filters.** A `list` rule is evaluated against candidate documents, and the whole
query is rejected if any candidate would fail. Two client queries must therefore be written to
match the rules exactly:

- Organization Selection: `where('uid','==',auth.uid).where('is_active','==',true)`
- Member directory for a non-Admin: `where('organization_id','==',activeOrgId).where('is_active','==',true)`

An Admin may drop the `is_active` filter to see deactivated members; a non-Admin may not, and
omitting it rejects the query rather than filtering the results.

Rules are tested with `@firebase/rules-unit-testing` against the Firestore emulator. The suite must
cover, at minimum: cross-organization isolation, enumeration attempts on every `list`-denied
collection, self-assignment of permissions during join, membership creation without a valid proof,
join with a revoked code, admin transfer by a non-Admin, admin transfer to an inactive member,
deactivating the current Admin, and re-joining with a code after deactivation.

## 34. Field Naming — `organization_id` Everywhere

Every document that references an organization uses `organization_id`. `org_id` is not used
anywhere in the project.

This matches the collections designed earlier — `inventory_items`, `maintenance_records`,
`production_requirements`, `action_items`, `calendar_events`, `teams` — so a single name means the
same thing in every collection and in every Security Rule.

Document ID patterns are unchanged: `organization_memberships/{organizationId}_{uid}`,
`organization_membership_join_proofs/{organizationId}_{uid}`.

## 35. Join Code Document Holds No `code` Field

`organization_join_codes/{code}` stores `organization_id`, `organization_name_snapshot`, `active`,
`created_by_uid`, `created_at`, and `revoked_at`. The document ID is the canonical join code and is
not duplicated as a field, because a second copy could disagree with the ID and Rules would then
have to decide which one is authoritative.

## 36. Organization Rename Is Atomic Across Two Documents

`organization_name_snapshot` stays. A user validating a join code is not yet a member and cannot
read `organizations/{organizationId}`, so the snapshot is the only way the join preview can name
the organization.

Renaming an organization therefore writes two documents in one batch:

- `organizations/{organizationId}.name`
- the **currently active** join code's `organization_name_snapshot`

Security Rules verify the pair with `getAfter()`: an update to `name` is rejected unless the active
code's snapshot matches the new name after the commit. The current code ID comes from
`organization_admin_settings` and is shape-checked before use as a path segment.

Revoked and inactive codes keep their old snapshot. They cannot be used to join, so a stale name on
them is inert, and rewriting history on every rename would grow the batch without bound.

## 37. Two Creation Paths, Because the First Organization Has No Admin Yet

At the moment an organization is created there is no Admin to authorize anything, so rules that read
`organizations.admin_uid` cannot cover the first join code or the first admin settings document.

**Path A — initial organization creation.** Authorized by what the batch will produce.
`getAfter(/organizations/{organizationId})` must exist with `admin_uid == request.auth.uid` and
`created_by_uid == request.auth.uid`. The caller earns the right to create the first membership,
admin settings, and join code by becoming the organization's Admin in the same atomic write. Path A
is the only way `organization_admin_settings` is ever created.

**Path B — existing organization.** Authorized by what already exists.
`get(/organizations/{organizationId}).data.admin_uid == request.auth.uid`. This covers regenerating
a join code, updating admin settings, assigning memberships, renaming, and transferring
administration.

Keeping the paths separate keeps each condition minimal and makes the intent legible in the rules
file.

## 38. App Check Is Optional Post-MVP Hardening

App Check is not a prerequisite for any phase and is not part of the MVP.

It is **not** an authorization mechanism and does **not** provide rate limiting. No document may
describe it as standing in for either. Authorization is Firestore Security Rules, and nothing else.

MVP security rests on:

1. Firebase Authentication
2. Firestore Security Rules
3. A secure 80-bit join code from `crypto.getRandomValues()`
4. `get` / `list` separation, so nothing can be enumerated
5. Strict schema validation on every write
6. Rules tests against the Firestore emulator

The Spark-only constraint in decision 0 stands unchanged.

## 39. Phase 2 Splits Into 2A and 2B

Risks R1 and R2 — whether Firestore caches identical document access calls across a query
evaluation, and how the access-call budget is counted across a batched write — are **not treated as
guaranteed**. Architecture correctness does not rest on either being favourable.

**Phase 2A outcome.** The emulator suite passes at 1, 5, 10, and 20 members for both Admin and
non-Admin, and the four-document create batch commits within the access-call budget. That is enough
evidence to proceed to Phase 2B. It is not a promise: Firebase documents that some access calls are
cached and that cached calls do not count toward the limit, but it does not contract that behaviour
across a whole query evaluation, and the emulator is not production Firestore. If real Firestore
returns `permission-denied` or fails at scale, revisit the member directory authorization structure
rather than weakening the rule.

**Phase 2A — foundation, no interface**

- domain types
- organization services (create, join, assign, transfer, regenerate, rename)
- `firestore.rules`
- Firestore indexes, if the queries require any
- `@firebase/rules-unit-testing` suite
- transaction and batch validation, including the directory query at 1, 5, 10, and 20 members

**Phase 2B — interface**

- Organization Selection
- Create Organization
- Join Organization
- Admin organization management

**Phase 2B does not begin until the Phase 2A rules tests pass.** If the directory query hits the
access-call limit, or a query and its rule turn out to be incompatible, stop and report before
building any interface on top of it. Do not relax a rule, widen a `list` permission, or drop a
required query filter to make something pass.

## 40. Inventory Team Scope Is an Editing Boundary

Reading and editing are scoped differently, and deliberately so.

| Effective role | Read | Create / update |
|---|---|---|
| Admin | every item in the organization | every item, any team |
| `inventory: edit` | every item in the organization | only items whose team is one of theirs |
| `inventory: view` | every item in the organization | nothing |
| `inventory: none` | nothing | nothing |

The product's first question is "what equipment and materials do we own?", and an answer limited
to the reader's own team would not be an answer. A stage manager on one team has to see lighting
and costume stock to plan against it, and from Phase 5 production requirements link to inventory
items across every team — a team-scoped read would make those links impossible to create.

What team scope protects is authorship: one crew cannot quietly change another crew's records.
That property is fully delivered by scoping writes alone.

Consequences for the implementation:

- The member list query and the Admin list query are the same:
  `where('organization_id', '==', activeOrganizationId)`. No `in` filter on teams, no composite
  index, and no exposure to the 30-value limit on `in`.
- `PermissionGuard` decides module access only. Team scope is enforced in the write rules and
  mirrored in the interface, which hides edit controls on other teams' items.

## 41. Inventory Items Require a Team

`inventory_items.team_id` is required, not optional.

An item with no owning team would be editable by nobody but the Admin, which makes it useless to
the crew that actually handles it. Creating an item requires choosing a team that exists in the
same organization, and Security Rules verify both.

An organization holding shared equipment creates a team for it — General, or Shared Equipment —
rather than leaving the field empty. No nullable or team-less inventory model is added for that
case in the MVP.

## 42. Inventory Category Uses a Fixed Set

`inventory_items.category` is one of the twelve MVP categories in `PROJECT_SPEC.md` section 7.4:

Lighting Instruments · Cables · Lighting Accessories · Sound Equipment · Microphones · Tools ·
Set-Building Materials · Platforms / Flats · Props · Costumes · Hardware ·
Miscellaneous Technical Equipment

Free text would defeat the category filter it exists to serve: two people typing "Lighting" and
"lighting instruments" for the same shelf split the inventory in a way no filter can rejoin.

The list is held in three places and they must agree: `PROJECT_SPEC.md` section 7.4,
`INVENTORY_CATEGORIES` in the application, and the Security Rules that reject anything else.
Adding a category later means editing all three; because Rules only compare against the list,
no migration of existing documents is involved.

---

## IA v3 ↔ /docs Conflict Resolutions

| Topic | IA v3 | /docs (before) | Resolution |
|---|---|---|---|
| Permission storage | `team_permissions` collection, per (uid × org × team) | permission map on membership | Membership map (decision 2) |
| Permission modules | 4 (inventory, maintenance, production, calendar) | 6 (adds dashboard, action_list) | 4, with Dashboard and Action List following other modules (decision 3) |
| Membership state fields | `role` + `status` | `role` only | `role` only; two fields would drift |
| Member promotion | automatic on permission assignment | manual status change | Automatic (decision 11) |
| Join code location | field on `organizations` | `organization_join_codes` collection | Separate collection (decision 4) |
| Admin identity | `admin_uid` on `organizations` | derived from membership role | **`admin_uid` on `organizations`** (decision 26). The IA v3 shape was adopted after the Spark change: with no stored role, one field on one document is what makes a single Admin structural |
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
