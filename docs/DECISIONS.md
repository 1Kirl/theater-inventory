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

## 43. Maintenance Team Is a Historical Snapshot

`maintenance_records.team_id` is required, copied from the linked inventory item at creation, and
immutable afterwards. Security Rules verify the copy matches at creation.

If the item's owning team changes later, existing records keep the team they were filed under —
that team is who actually sent the equipment out, and rewriting history to match the present would
misattribute the repair.

Where the snapshot and the item's current team differ, the interface says so:

> Team at time of service: Lighting

Where they agree it shows the team plainly, with no note. Edit scope is judged against the
snapshot, so the crew that filed a repair keeps control of it.

## 44. Currently In Service

The Inventory Item Detail quantity summary shows **Total · Available · In Service · Condition**.

In Service is derived, never stored: the sum of `quantity_sent` across that item's records whose
status is `sent`, `in_service`, or `ready`. It is displayed **beside** `quantity_available` and
never subtracted from it — `quantity_available` stays the manually maintained authoritative value
from decision 15.

It follows the maintenance permission, not the inventory one, on the same principle as the
dashboard cards in decision 3: a figure derived from a module's data requires access to that
module.

- `maintenance` at view or edit, and Admin — four values, plus the maintenance history.
- `maintenance` at none — three values, and the maintenance section says access is required.

This is not only a policy choice. In Service is computed from `maintenance_records`, so without the
permission Security Rules refuse the read and there is no number to show.

## 45. Active Maintenance Quantity Is a Warning, Not an Invariant

Per record, Security Rules enforce that `quantity_sent` is an integer above zero and no greater
than the linked item's `quantity_total`.

The **sum** across an item's active records is a derived operational indicator, not a constraint.
Exceeding `quantity_total` is a warning condition, and the write is still allowed.

Two reasons, and the first is decisive:

- Security Rules cannot enforce it. They have no query capability, so aggregating an unknown set of
  sibling documents is not expressible. A check living only in the client would look like a
  security boundary while being trivially bypassable — worse than no check, because it invites
  trust it cannot earn.
- It is not always an error. Sending six of ten units for repair and later scrapping three brings
  the total below what is out, from entirely correct data.

The form warns before saving, in language that names the numbers:

> This would put 12 of 10 units in service. Check the maintenance quantities or the item's current
> total.

The warning is visually distinct from a validation error: an error blocks the save, a warning does
not. No document may describe this aggregate as enforced.

`quantity_available` is never adjusted by any of this.

## 46. Requirement Availability Is `quantity_available`, Unadjusted

Shortage is computed from the linked inventory item's `quantity_available` and nothing else:

```
available = inventory_item.quantity_available
shortage  = max(required_qty - available, 0)
```

Quantity currently in service is **not** subtracted. `quantity_available` is already the number a
person maintains as genuinely available (decision 15), so subtracting the in-service figure would
deduct the same equipment twice — once when the technician lowered the available count, and again
from the maintenance records.

Worked example:

| | |
|---|---|
| `quantity_total` | 10 |
| `quantity_available` | 7 |
| currently in service | 3 |
| required | 8 |
| **available** | **7** |
| **shortage** | **1** |

Not available 4 and shortage 4.

Availability is read live, never stored on the requirement. When an item's `quantity_available`
changes, every requirement pointing at it reports a different shortage the next time it is read.
Only the Action Item's `quantity` is a snapshot, and deliberately so — it records what the crew
decided to do, not what the arithmetic currently says.

## 47. Requirement and Action Teams

`production_requirements.team_id` and `action_items.team_id` are both required.

The requirement's team names the crew responsible for the need, and edit scope is judged against
it. The Action Item copies it, and Security Rules verify the copy matches; an action cannot be
filed under a different crew than the requirement it resolves.

The **linked inventory item's team is unrelated**. A sound requirement may match a lighting item,
and nothing rejects that — decision 40 exists precisely so those cross-team links are possible.

Matching an item requires `inventory` view, because the item is inventory data and module
permission governs module data. That is the combination `PERMISSIONS.md` Example B already gives a
stage manager: Productions edit alongside Inventory view. No rule exception is added for
productions; a planner without inventory access can still record an unmatched requirement, and the
interface says what is missing.

## 48. The Action Plan Lives Only on the Action Item

`production_requirements` has no `action_type` field.

Storing one there alongside `action_items.action_type` would create two places
holding the same decision, free to disagree:

```
requirement.action_type = 'rent'
action_item.action_type = 'buy'
```

Nothing could say which one the crew meant. The Action Item is the operational record — it carries
the quantity, the status, the assignee, and the due date — so it holds the action type too.

The persisted set is four values: `buy`, `rent`, `build`, `repair`.

**Already Available is not among them.** It is the derived state of a requirement whose shortage is
zero, computed at read time and never written anywhere. A requirement covered by stock needs no
work, so there is no Action Item to hold a type for.

When the AI Requirement Generator lands in Phase 7, a suggested action stays a transient suggestion
in the approval interface, or becomes an Action Item once approved. It is not written back onto the
requirement.

## 49. What Calendar Rules Can and Cannot Enforce

Calendar is the first **organization-level** collection with real write traffic. Team scope does
not apply to it at all: a member with `calendar` edit may create and change any event in the
organization, whatever teams it names.

`team_ids` is display metadata. Security Rules validate its **shape** — a list, within a sane
length, and consistent with `visibility` — and nothing more:

- `visibility: 'all_teams'` requires `team_ids` to be empty.
- `visibility: 'teams'` requires at least one entry.

Rules deliberately do **not** verify that each entry names a real team in this organization.
Checking a variable-length list of references is not expressible: Rules can `get()` a known path,
not iterate an array of unknown length. A partial check — validating only the first entry, say —
would be worse than none, because it would read as integrity while guaranteeing nothing.

The interface offers only this organization's teams, so a stray ID takes deliberate effort to
produce, and produces nothing: an unrecognized ID is dropped when team names are resolved for
display. `team_ids` is not security-sensitive, so this is a tidiness question rather than a
boundary one.

Linked records are a different matter and **are** enforced: `production_id` and `maintenance_id`
name single documents at known paths, so Rules confirm each exists in the same organization.

**Calendar events may be deleted**, by an Admin or anyone with `calendar` edit. This is the only
collection in the MVP where deletion is allowed, and `IA.md` section 9.2 states it directly. A
cancelled rehearsal is not history worth keeping the way a repair record or an action item is.

`event_type` stays free text, as `DATA_MODEL.md` defines it. `IA.md` lists rehearsal, build day,
equipment inspection, repair pickup/return, and production deadline as **examples**, not a closed
set, so the form offers them as suggestions and the filter is built from the values an
organization has actually used.

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

---

## 50. App Check Is Now Part of the MVP

`AI_SPEC.md` originally recorded App Check as optional post-MVP hardening. That is no longer
true: Firebase AI Logic enforcement is switched on in the console, so a request without a valid
App Check token is rejected by the service. Without App Check there is no AI feature.

Production uses reCAPTCHA Enterprise with the registered site key. Localhost uses the SDK's debug
provider, chosen by `import.meta.env.DEV`, which Vite resolves at build time — the debug branch is
eliminated from the production bundle rather than guarded by a runtime check. Localhost is
therefore never added to the production reCAPTCHA key.

In debug mode the provider passed to `initializeAppCheck` is a `CustomProvider` that issues
nothing, not `ReCaptchaEnterpriseProvider`. The SDK calls `provider.initialize()` whether or not
debug mode is active, and the enterprise provider would load the reCAPTCHA script with the
production site key from localhost. `CustomProvider.initialize` does nothing, and its `getToken`
is unreachable in debug mode — it rejects, so a non-debug misconfiguration fails rather than
passing quietly.

**App Check is not authorization.** It attests that a request came from this app; it says nothing
about who is behind it. Firestore Security Rules remain the only authorization boundary.

### 50a. Environment variables are read by name, never as a whole object

`readFirebaseEnv()` originally passed `import.meta.env` to Zod as one object. Vite replaces a bare
`import.meta.env` with an object literal containing *every* `VITE_` variable it loaded, so that
form baked unrelated values into whatever bundle was built next — including a development-only App
Check debug token sitting in `.env.local`. This was confirmed with a canary value, not reasoned
about: the canary appeared in `dist`.

Each variable is now named explicitly, and the debug token is read by a function called only from
inside the `import.meta.env.DEV` branch, so dead-code elimination drops the literal along with the
branch. A debug token is a secret — it lets any caller pass App Check for this project — and the
reCAPTCHA site key and Firebase web config are not.

---

## 51. What the AI Decides, and What It Cannot

Both AI features return language, never data. The model interprets a sentence; the application
owns every query, identifier, calculation, and write.

The boundary is one function, `AiGenerate` in `src/features/ai/ai-client.ts`. Above it, prompts
are built by pure code and responses are validated by Zod with `strictObject`, so an unknown field
fails the response instead of being quietly dropped. Below it is the only place the SDK is
reached, which is why unit tests can stub the whole path and never touch the network.

Neither feature sends inventory records to the model. Smart Search sends the vocabulary to choose
from and the user's sentence; the Requirement Generator sends the production's own text, team
names, and the category list, and returns a search keyword the application resolves afterwards.
A model that has seen a partial inventory will answer from it, and that answer is a claim about
what the organization owns that nobody checked.

### 51a. Identifiers are resolved, never returned

`team_name` and `inventory_match_keyword` are names. Resolution is deterministic and happens in
application code: exact normalized match, then a single unambiguous partial match, then nothing.
Ambiguity resolves to null rather than to a guess, and an unresolved name is reported to the user
rather than silently dropped from a filter.

A second model call to resolve a name would put the model back in charge of an identifier, which
is the one thing it must never decide. The schemas additionally reject any value shaped like a
Firestore auto-ID, for a field that is legitimately free text.

### 51b. Approval is what creates a record

Generation produces review rows. Every row starts unaccepted, and the save button writes only the
rows a person ticked and left in a savable state. A row whose team the reviewer may not write to
cannot be accepted at all — Security Rules would refuse it, and asking in the review UI is kinder
than failing at save.

Saved records carry `source: 'ai_approved'`, which records that a person approved a suggestion.
It is not a claim that the model wrote anything, and no rule trusts it: a rule that treated
`ai_approved` differently would be trusting a claim the client makes about itself.

### 51c. Arithmetic stays where it was

The model may suggest a required quantity. It may not return an available quantity or a shortage,
and the schema has no field for either. Shortage is computed after saving by the Phase 5 logic —
`max(required_qty - quantity_available, 0)`, with `currently_in_service` not subtracted, per
decisions 44 and 46.

### 51d. Inventory linking has a defined threshold

The application links a suggestion to an inventory item on its own only when exactly one item's
name equals the keyword after normalization. Anything looser is offered as a candidate and left
unmatched. "Not Matched" is a normal state; a wrong link is not, because it produces a wrong
shortage on a real record without anyone noticing.

### 51e. AI availability is not a dependency

Smart Search sits above the manual filters and writes into the same filter state, so its result is
an ordinary filtered list the user can then adjust. Manual requirement entry is untouched. Every
AI failure — App Check, service disabled, quota, model unavailable, network, malformed JSON, Zod
rejection, empty output — is classified into a short message that repeats none of the underlying
detail, and leaves both pages working.

---

## 52. The AI Is Data-Aware

Decision 51 said neither feature sends inventory records to the model. That is superseded.

The reasoning behind it was sound as far as it went: a model that has seen a partial inventory will
answer from it, and such an answer is a claim about what the organization owns that nobody checked.
What it bought in safety it paid for in usefulness. A user could not ask "what has never been
inspected", "does anything need attention", or "do we have enough microphones for twenty
performers" — the questions the product exists to answer. What shipped was a natural-language front
end for the filter dropdowns.

Both features now send a compact view of the inventory the current user may already read. Firestore
is still read by the application under Security Rules; the model never touches it.

### 52a. Temporary references are what make it safe

Records are labelled `I1`, `I2`, … per request, and the map back to real items lives only for the
life of that request. Names, quantities, conditions, locations, and inspection dates travel; no
document ID does, and nothing about members, accounts, or authentication does.

Every reference the model returns is looked up in that request's map. An invented `I99`, an echoed
document ID, a repeat — all resolve to nothing. What reaches the screen is therefore always a
subset of what the application itself put into the request. The old rule made a fabricated record
impossible by starving the model; this makes it impossible by checking, and the checking is what
scales to a model that can actually answer the question.

### 52b. The application still owns every number

The model writes prose and picks references. Availability and shortage are computed from the
matched record by the Phase 5 logic and recomputed whenever the reviewer edits a quantity or
changes a match, so the figures on screen cannot drift from the records even if the model's
sentence does. The system instruction tells it not to do that arithmetic, and the schema gives it
nowhere to put the result if it tried.

### 52c. Suggested action is advice, not a field

`suggested_action` appears in the review UI and does not survive the save. Decision 48 removed
`production_requirements.action_type` because a second copy of the plan could disagree with the
Action Item, and that still holds — this is a hint about what to do next, not a stored plan.

### 52d. Context is capped at 250 records, and the cut is announced

Measured rather than assumed: a worst-case record line is 288 characters, roughly 72 tokens; a
typical one is 162, roughly 41. 250 records is about 18,000 tokens at worst. A department tracking
more than that is past this MVP's scope.

Above the cap, records matching words from the user's question are sorted to the front and the cap
is taken from there. Nothing is dropped silently: the prompt header tells the model how many were
left out and not to claim the list is complete, and the UI tells the user the answer may not cover
everything.

### 52e. Without inventory permission, nothing is read

A productions editor with no inventory access can still use the Requirement Generator. No inventory
is read, no context is sent, the result is labelled general guidance, and every suggestion stays
unmatched until someone with access resolves it. There is no Security Rule exception; the
permission model is unchanged.

---

## 53. Truncation Was the Structured-Output Failure

An ordinary Requirement Generator prompt returned "The AI response could not be read". The cause was
in the SDK boundary, not in the model's understanding.

`maxOutputTokens` was 2048, and thinking tokens count against that budget. More importantly,
`MAX_TOKENS` is **not** in `@firebase/ai`'s `badFinishReasons` list, so a truncated generation is
not an error to the SDK: `response.text()` returns the partial text. That partial text is JSON cut
off mid-value, `JSON.parse` throws several layers later, and the failure surfaces as "malformed" —
a symptom whose cause the message could not name.

The fix has four parts:

- `maxOutputTokens` is 8192, enough for an assessment, a dozen suggestions, and thinking on top.
- `thinkingConfig` is left at the model's default. The SDK errors outright if a thinking budget
  falls outside a model's supported range, and a knob that can hard-fail is not worth introducing
  untested when a larger budget solves the problem.
- The boundary returns `{ text, truncated }`, reading `finishReason` directly, so truncation is
  named rather than inferred.
- A truncated response is repaired structurally — closed at the last point where its structure was
  whole — and validated normally. No key is invented and no value is completed.

Alongside it, the Requirement Generator validates each suggestion on its own, so eight good
suggestions and two bad ones is eight suggestions and a note rather than a failed request. Safe
normalization runs before Zod and never instead of it: numeric strings, empty optional strings,
category casing, and unambiguous field aliases. An invented identifier, an unknown reference, or an
invalid quantity is never normalized into something valid.


---

## 54. A 429 Is Two Different Situations

The Gemini Developer API free tier limits requests per day per project and model. On
`gemini-3.5-flash` this was confirmed at 20 per day, arriving as HTTP 429 with
`quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier`.

The original handling called every 429 "busy right now, wait a moment". That is accurate for a
per-minute limit and actively misleading for a per-day one: it tells someone to retry in a minute
when the answer is tomorrow, and they will retry, and it will fail again.

The application now reads the `google.rpc.QuotaFailure` detail. A `quotaId` containing `PerDay`
produces "Today's AI usage limit has been reached"; every other 429, including one the service did
not label, keeps the generic wording. An unlabelled 429 is never assumed to be the daily one —
guessing wrong in that direction tells someone to give up for the day over a one-minute limit.

The message names no plan, model, or number. None of it is something the person reading can act on,
and a quota figure in a user-facing string goes stale the moment the project's billing changes.

This is a wording decision, not an architectural one. Moving to the paid tier of the same Gemini
Developer API is a billing change on the Firebase project: the SDK, `GoogleAIBackend`, the model,
the contracts, and the security model are untouched, and this branch simply stops being reached.

---

## 55. What the Dashboard's Repair Cards Count

`IA.md` section 4.1 lists **Needs Repair** and **Currently in Service** as separate summary cards,
and assigns both to the `maintenance` permission. The IA label alone is ambiguous: `needs_repair` is
also an inventory condition key, so the card could plausibly count inventory items in that
condition.

It counts maintenance records, because that is what the permission assignment says. A figure
derived from a module requires access to that module — decision 3, and the same reasoning as
decision 44 — and inventory conditions are readable with `inventory` view, not `maintenance` view.
Counting them here would put an inventory figure behind the maintenance permission.

The two cards are therefore:

- **Active Repairs** — repair records still open, meaning status is neither `returned` nor
  `cancelled`. A count of jobs.
- **Currently in Service** — `currentlyInService()`, the existing rule: units summed across records
  whose status is `sent`, `in_service`, or `ready`. A count of units.

Different units and different sets, so neither restates the other. A `planned` repair is open but
has not left the building, which is exactly the gap between the two numbers.

### 55b. The card is labelled Active Repairs, not Needs Repair

`IA.md` calls the card **Needs Repair**. The interface calls it **Active Repairs**, and the count
behind it is unchanged.

The IA wording collides with the inventory condition of the same name, which is a different figure
behind a different permission and appears elsewhere on the same page. Two cards a screen apart
reading "Needs Repair" and meaning different things is the kind of thing nobody notices until a
number is quoted in the wrong conversation.

"Active" carries its own hazard: `ACTIVE_STATUSES` in the maintenance domain means `sent`,
`in_service`, and `ready`, which is the narrower set the *other* card sums. The card's supporting
line therefore says "Open records, including repairs not yet sent" rather than leaving the word to
do the work alone.

The inventory condition angle is not lost: the Inventory Condition card reports how many items are
mostly needing repair or unusable, derived with the existing `conditionSummary`, and sits behind
`inventory` view where it belongs.

### 55a. A shortage that cannot be computed reports null, not zero

Shortage is measured against the matched inventory item's available quantity. A user with
`productions` view but no `inventory` view has no inventory to measure against — the dashboard does
not read it, and Security Rules would refuse if it tried.

That case reports null and the interface says "shortages need inventory access". Zero would read as
"nothing is short", which is a different statement and possibly a false one.

---

## 56. Organization Administration Lives in One Place

There is no separate Team & Members page. Teams, member team assignment, module
permissions, promotion from Unassigned, member deactivation, and Admin transfer are all sections of
**Organization Settings**, which is where they were already implemented.

`IA.md` section 10 lists Team & Members as its own screen, and the sidebar carried an entry for it
that led to a placeholder for six phases. Building the page would have meant either splitting the
existing settings sections across two screens or duplicating them; keeping one screen means one
place for an Admin to look and one set of guards to reason about.

The sidebar entry is gone. `/team` is kept as a redirect to Organization Settings, so a bookmark
from an earlier build still lands somewhere useful rather than on a 404. The placeholder component
is removed, and no Firestore schema, Rules, or permission behaviour changed.

---

## 57. Feature Routes Are Fetched On Demand

Every page behind a guard is a separate chunk, declared in `routes/lazy-routes.ts`. What stays
eager is what the first paint needs: the shell, the guards, the providers, and the two
authentication screens.

The entry bundle went from 1,309 kB to 351 kB. The Firebase SDK is pinned to its own `firebase`
chunk by `manualChunks` for one reason — caching. It is 565 kB and changes only when Firebase is
upgraded; grouped with application code, editing a button would give the whole thing a new hash and
every returning user would download it again.

`@firebase/ai` is deliberately excluded from that chunk. The AI panel and the requirement generator
are themselves lazy, so the AI SDK travels with them: the dashboard, the calendar, maintenance, and
productions never fetch it, and the requirement generator fetches it only when someone opens it.

Suspense boundaries sit inside `AppShell` and `AuthGuard`, so the sidebar and header stay on screen
while a page's code arrives rather than the whole window blanking.

---

## 58. Effects Start Work; They Do Not Set State

Every data-loading effect in the application now settles its state in a promise continuation rather
than synchronously. The pattern is uniform:

```ts
const load = useCallback((): Promise<void> => {
  if (!organizationId) return Promise.resolve()
  return listX(organizationId).then(
    (loaded) => { setX(loaded); setError(null) },
    (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setX([]) },
  )
}, [organizationId])
```

Returning the promise keeps `load` awaitable for the dialogs that refresh after a write.

Two providers needed more than that:

- `AuthProvider` decided during an effect whether Firebase was configured. That is a synchronous
  fact about the build, so it is settled during the first render instead.
- `OrganizationProvider` cleared its organization from an effect when the user signed out, and
  reset four pieces of state on every load. It now holds one entry tagged with the organization it
  belongs to, and the exposed value is derived: an entry for a different organization, or one left
  from a previous account, simply does not match. Signing out drops the organization during render,
  where before there was one paint in which the next account could have seen the previous
  account's organization. `loading` is derived too — an organization we should have, nothing
  resolved for it, and no error to explain why.

The project's lint policy is now **zero warnings**, not merely zero errors.

---

## 59. Date Inputs Round-Trip Through Local Parts

Four forms wrote a date with `new Date('YYYY-MM-DDT00:00:00')` — parsed as **local** midnight — and
read it back with `toISOString().slice(0, 10)`, which answers in **UTC**.

East of Greenwich the two disagree by a day. A production starting 2026-09-05 came back into the
edit form as 2026-09-04, and saving again moved it another day earlier. The displayed date was
right, because the lists use `toLocaleDateString()`; only editing walked it backwards, which is the
version of this bug that takes longest to notice.

All four now read back with `toDateKey()` from `domain/calendar`, the same local-parts function the
calendar has used since Phase 6, and which decision 49 records the reasoning for. Affected:
production start and end dates, inventory last-inspected, maintenance sent/expected/returned dates,
and the action item due date.

---

## 60. The Demo Dataset Is Seeded Through the Client, as Two Ordinary Users

The QA and demonstration data is real Firebase data — Auth accounts and Firestore documents — not
sample arrays rendered by the interface. A seeded record has to behave exactly like one a person
created, or testing against it proves nothing.

`npm run seed:demo -- --confirm` writes it with the ordinary client SDK, signed in as the demo Admin
and then as the demo Member. Every document passes the same Security Rules as any other write: the
organization is created in the same batch shape the application uses, the Member joins with the
organization code and a join proof, and the Admin assigns teams and permissions afterwards. There is
no Admin SDK, no service account, and no rule relaxed to make seeding easier.

Whether this was possible at all was established rather than assumed. A read-only probe confirmed
that App Check enforcement covers Firebase AI Logic only: an unauthenticated sign-in attempt was
refused on credentials, and an unauthorized Firestore query was refused by Rules — neither by App
Check. A Node client can therefore authenticate and write normally.

### 60a. Shapes are shared; service wrappers are not

The script imports the application's own payload builders, so a seeded document cannot drift from a
real one. It does not use the service layer, because those modules read configuration through Vite's
`import.meta.env`, which does not exist in Node. The script reads `.env.local` itself and builds its
own Firebase app.

Node 22 strips TypeScript types natively, so the script needs no build step. The project's `@/`
alias is taught to Node by a small resolver hook in `scripts/`, which is what allows the builders to
be shared rather than the document shapes copied.

### 60b. Safeguards

Running it takes an explicit `--confirm` flag and a `.env.seed.local` that is gitignored. It refuses
to run a second time against an organization it already created, found the way the application finds
organizations — through the caller's own memberships, since listing organizations is denied to
everyone. It touches nothing outside the organization it creates, and there is no reset or delete
path: removing the demo data is a deliberate act in the Firebase console.

No password appears in the repository. The dataset itself is described in `src/domain/demo-dataset.ts`
as plain data with local keys, so its invariants — that the microphone shortage is real, that every
action refers to a matched and short requirement, that no repair sends more units than exist — are
unit-tested without touching Firebase.

---

## 61. Inventory Is Tracked Two Ways

An inventory item now declares how it accounts for the physical things it
represents. `bulk` is the original model: one document holding quantities a
person maintains. `serialized` gives each physical object its own document in
`inventory_units`, so a question like "which of the twenty-four is missing" has
an answer.

Forcing every item to be serialized was considered and rejected on the data.
The seeded demo inventory is 17 items representing 273 physical objects, and the
five largest are lumber (60), gel frames (40), XLR cables (30), C-clamps (24),
and DMX cables (20) — 64% of the total. Sixty lengths of lumber do not have
individual identities to track; they stop being those lengths the moment
somebody cuts one. A hybrid needs 99 unit documents where all-serialized needs
273.

**The mode is chosen per item by the user, never derived from the category.** A
clamp worth tracking individually in one school is a box of hardware in another,
and that is not a judgement this application is entitled to make. A category may
suggest a default in the interface; it may not decide.

Promotion from bulk to serialized is allowed and one-way. Going back would
strand the unit documents and the history attached to them; a fresh item is the
honest alternative, and Security Rules refuse the reverse.

### 61a. Items written before this have not changed

No document currently in Firestore carries `tracking_mode`, and none was
migrated. A missing field reads as `bulk` — which is what those items have
always been — through `trackingModeOf()`. Nothing about their behaviour differs.

The payload builder now always writes the field, including for bulk items. That
is not decoration: an update replaces the whole document rather than merging, so
a form that did not carry the mode forward would quietly turn a serialized item
back into a bulk one.

---

## 62. Condition and Lifecycle Status Are Different Questions

A unit carries both a `condition` (the existing five values) and a `status`:
`available`, `in_use`, `in_maintenance`, `lost`, `retired`.

Folding them into one field would make two ordinary states unsayable:

```
condition = good,         status = retired    — perfectly fine, and given away
condition = unusable,     status = available  — on the shelf, and worth nothing
```

Retirement is terminal and carries a reason — `disposed`, `permanently_lost`,
`donated`, `sold`, `other`. Equipment that comes back is a new unit, because the
old one really did leave the inventory.

There is no delete. Losing something and discarding something are both recorded,
because the record is what the collection exists for. See the Phase 11 analysis,
decision 7.

---

## 63. What Available Means for a Serialized Item

```
available  ⟺  status == 'available' AND condition != 'unusable'
```

Two departures from the bulk model, each deliberate:

**Needs repair still counts.** Something needing attention has not stopped
working, and the crew may well use it before it goes for service. The interface
warns; the count does not lie.

**Unusable does not count.** This is a change from the aggregate model, where
`quantity_available` was a number a person maintained independently of
condition. A production told it can count on equipment that cannot be used is
being told something false, and the shortage that follows is wrong.

The consequence is accepted rather than hidden: promoting an item to serialized
can change its available count, and therefore a production's shortage. Phase 11B
must show that difference before a promotion completes, and must not invent the
lifecycle state of units the old aggregate could not describe — twelve total and
eight available says nothing about where the other four are.

Bulk items are untouched by all of this. `quantity_available` remains what a
person maintains.

---

## 64. The Summary a Serialized Item Carries

```ts
unit_counts: {
  active_total, available, unusable_on_hand,
  in_use, in_maintenance, lost, retired
}
```

The obvious invariant is not the one that holds. `unusable_on_hand` is the term
that makes it work:

```
active_total == available + unusable_on_hand + in_use + in_maintenance + lost
```

A unit on the shelf in unusable condition is present and active, but nothing can
count on it. Without a bucket of its own the totals would not add up and a
reader would be left guessing where the missing units went.

`retired` sits beside the active total rather than inside it. Lost units stay
*in* it: "twenty-four total, three lost" is a sentence the product has to be able
to say, and subtracting them would erase the fact.

### 64a. The parent mirrors what its units say

A serialized item keeps `quantity_total`, `quantity_available`, and
`condition_counts` in step with its units. That is what lets production
shortage, the dashboard, the inventory list, and the AI context keep reading
exactly the fields they already read — none of them learns that units exist.

`condition_counts` for a serialized item counts **non-retired units by
condition**, so it sums to `active_total` exactly. A serialized item has no
unclassified remainder, unlike a bulk item where the counts are a person's
partial record of a quantity. Rules enforce the exact sum for serialized items
and keep the looser bound for bulk ones.

### 64b. What Rules can and cannot enforce about the counts

Rules enforce that the numbers are non-negative integers, that the buckets add
up, and that the mirrors match. What no rule can check is whether the numbers
match the units they claim to count: Rules cannot query a collection.

Later phases keep them true by mutating a unit and its parent inside one
transaction, so a lifecycle change either lands completely or not at all. That
is the normal consistency mechanism. A recalculation tool may exist as a safety
net; it is not the mechanism.

---

## 65. Why a Unit Copies Its Parent's Organization, Item, and Team

`inventory_units` carries `organization_id`, `inventory_item_id`, and `team_id`,
all immutable, all copies of the parent's.

This is not convenience. Security Rules spend access calls, and the budget is 10
for a single write and 20 for a transaction. A unit write that had to read its
parent would spend two more, and a future checkout — unit, parent counters, and
an event in one transaction — would not fit. The copies let
`canWriteInventoryForTeam` authorize a unit write without reading anything else.
`maintenance_records` carries a team snapshot for the same reason (decision 43).

The parent is read exactly once, at creation, to confirm the copies are honest.
Afterwards all three are immutable, so re-reading would buy nothing. The owning
team especially: it is what the rule authorizes against, so a writable copy could
widen who may edit the unit.

The cost is that a serialized item's owning team cannot change while units exist.
That is a real limitation, and locking it is the safe half of the trade; a
dedicated ownership transfer can be designed later if it is ever wanted.

### 65a. Asset codes are labels, not identifiers

`asset_code` is what a person reads off the equipment. Uniqueness is checked in
the interface and not enforced by Rules, which cannot query a collection to find
a duplicate.

A claim-document pattern was considered and rejected: it would double the writes
for every unit, and a bulk creation of twenty-four clamps would blow the access
budget. The identifier is `unit_id`, and that is what a QR code will encode. Two
units sharing a label is untidy, not broken.

### 66. A whole batch of units goes in one transaction, and the ceiling was measured

Decision 65 assumed the access-call budget would force units to be written a few
at a time. That assumption was wrong, and `tests/rules/inventory-unit-transactions.test.ts`
is where it was checked against the published Rules rather than reasoned about.

Rules charge for each *distinct* document a batch reads, not for each evaluation.
Every unit of one item reads the same parent, so the whole batch costs one access
call. Measured on the emulator: **four hundred units plus their parent commit in a
single batch**, while twenty-five units under twenty-five different parents fail —
that second case is where the budget of twenty actually bites.

So `createInventoryUnits` and `promoteToSerialized` each run as one transaction:
read the parent, compute the mirrors from what it currently says, write every
unit and the parent together. `MAX_BULK_UNITS` is 200, inside both the measured
ceiling and Firestore's own limit of 500 writes per transaction.

This is better than one transaction per unit on both counts that matter. There is
no partial batch to explain, and the parent is read inside the transaction, so
two people adding units at once cannot compute their counters from the same stale
total.

### 66a. A failed promotion leaves a working bulk item

Because the conversion is one transaction, an interruption changes nothing: the
item is still a bulk quantity with its original numbers, and no units exist. A
half-converted item that looks healthy but is missing units is not a state this
can reach.

### 67. Units live at `/equipment/:unitId`

Not `/inventory/:itemId/units/:unitId`. A unit is reached from a shelf label as
often as from its item page, the URL is what a QR code will eventually encode,
and a path carrying only the unit's own id keeps working when the item is renamed
or when the unit is the only thing the reader knows. The route sits behind the
same `inventory` view guard as every other inventory page.

### 68. Lifecycle status is not an editable field

The unit form shows status and does not let anyone change it. Checking equipment
out, sending it for repair, losing it, and retiring it each have consequences and
each deserve their own record; a dropdown would let someone move a unit between
them with none of that. New units start `available` for the same reason — this
phase has no way to record why a unit would start anywhere else. Condition is
editable, because condition is an observation rather than an event.

### 68a. A conversion never invents a condition or a borrowing team

Two things a bulk item does not record, which a serialized one requires.

`sum(condition_counts) <= quantity_total` is legal for a bulk item, so ten
recorded with eight classified leaves two units whose condition nobody ever
observed. Those drafts start `null` and the review step refuses to convert while
any remain. Filling them with `good` would have been easy and would have put a
number in the serialized summary that no one ever looked at.

The same applies to `using_team_id`. An earlier draft of the promotion assigned
the item's own owning team to any unit marked in use — which reads as reasonable
and is still a guess: the owning team is who the equipment belongs to, not who
has it. The review step asks, and Convert stays disabled until every in-use unit
names a real team of the organization.

Rules enforce the shape — an `in_use` unit must carry a non-empty
`using_team_id`, and a unit that is not in use must carry none. They cannot check
that the team exists, because that would cost an access call per unit and a
batch of two hundred has one to spend. The service checks it against the
organization's teams before the transaction opens.

### 68b. Unit ids are allocated before the transaction, never inside it

A transaction body re-runs when its read set changes underneath it. Refs
generated inside the body would differ on each attempt, so a retry would commit
a second set of units alongside the first. They are allocated once, outside, and
reused by every attempt.

The parent mirrors are computed absolutely rather than incrementally for the
same reason: the promotion derives them from the drafts, and unit creation
derives them from the parent snapshot that attempt just read. Neither adds to a
running total, so re-running the body produces the same numbers rather than
double-counting. `src/services/inventory-unit-service.test.ts` runs the body
twice and asserts both properties.

### 68c. A conversion cannot put a unit into maintenance

`in_maintenance` is a valid lifecycle status and is not offered by the promotion
wizard. A unit in maintenance is half a record: the other half is a maintenance
record naming the provider, the date it went out, and when it is expected back,
and the transition into the status is what creates it. Setting the status alone
would produce a unit stuck in maintenance with no repair to return from, no
history explaining it, and no legitimate way out.

So equipment genuinely away for repair cannot be described by a conversion yet.
The wizard says so rather than offering a status that would lie. Inventing a
placeholder repair record would have been the other option and is worse: a
fabricated repair is harder to find and undo later than an item recorded as
available. With no real user data yet, the limitation costs nothing.

A conversion may start a unit as `available`, `in_use`, or `lost`.

### 68d. New units are available, and only the conversion may say otherwise

The Add Unit and Generate Units paths refuse any status but `available`, in the
service rather than only in the form. Lifecycle transitions belong to the
operations that cause them, which arrive in a later phase; until then there is
no way to record *why* a unit would start anywhere else. The promotion is the
single exception, because it describes equipment that already has a history, and
it validates its drafts against its own narrower list.

### 69. Who a unit may be lent to, and where that is enforced

Rules hold a member to their own assigned teams: `using_team_id` must appear in
their membership's `team_ids`. This costs nothing — the membership document is
read to authorize the write regardless, so the check reads a second field of a
document Rules already have in hand. Owning team and using team may still
differ, which is the point; what a member cannot do is attribute equipment to a
crew they have nothing to do with.

An Admin is checked for shape only: present and non-empty. The stricter rule —
reading each team document to prove it belongs to the organization — was
implemented and measured before being rejected. One batch tolerates **seven**
distinct borrowing teams before the access-call budget runs out, because that
read is charged per distinct team. A department with eight crews would have a
legitimate conversion fail with a permission error it could do nothing about.

The trade is sound because it is not an authorization boundary. An Admin may
already write any inventory in their organization, so a `using_team_id` naming a
team that does not exist is a data-quality problem rather than an escalation.
The service validates it against the organization's real teams before the
transaction opens, and the wizard only ever offers real teams.

`using_member_uid` stays optional and is not collected anywhere yet.

### 70. An item with open repairs cannot be converted yet

Decision 68c stops a conversion inventing a unit in maintenance. The other side
of that is this: an item that *already* has an open repair cannot be converted at
all.

A bulk repair records a quantity — four of the twenty-four clamps went out — and
never says which four. Serialized maintenance attaches a repair to named units,
and that does not exist until a later phase. So an open repair has nowhere
accurate to go across the conversion. The alternatives were to drop it, or to
make the user file those four units as available, in use, or lost. All three are
false, and the third is the worst because it looks deliberate.

Returned and cancelled repairs block nothing. They stay as the aggregate records
they always were, and no attempt is made to attach them to the new units.

**Open** means not `returned` and not `cancelled` — `planned`, `sent`,
`in_service`, and `ready` all block. This is the definition the Dashboard's
Active Repairs card already used, which was a local helper in
`dashboard-summary.ts`; it now lives in `domain/maintenance.ts` as `isOpenStatus`
and both callers share it, so there is one definition rather than two that could
drift.

It is deliberately a different question from `ACTIVE_STATUSES`, which powers the
in-service quantity and excludes `planned`. That asks how much equipment is
physically away; this asks whether a repair is unfinished, and a planned repair
is very much unfinished. `isOpenStatus` is defined as the complement of the
closed statuses so a status added later blocks by default.

### 70a. Where the block is enforced, and what it cannot reach

The wizard's button is disabled with an explanation, and the service refuses
independently — a form is not a data-integrity boundary.

**Security Rules do not enforce this, and cannot.** Rules evaluate one write at a
time against documents they can name; they cannot query `maintenance_records` for
"any open record referencing this item". Rules were left unchanged for this
requirement rather than weakened to approximate it. The consequence is honest:
someone writing to Firestore directly, outside the application, could convert an
item with an open repair. That is the same class of limitation the whole
serialized-mirror design already carries — Rules check that the stored counts are
internally consistent and cannot check that they match reality.

Reading the repairs needs the maintenance permission. A user who may edit
inventory but not read maintenance cannot establish that nothing is open, and the
service refuses rather than converting on an assumption. Failing closed costs
that user a conversion; failing open would strand a repair.

### 70b. The residual race, stated plainly

Two people, no server:

1. the wizard reads the repairs and finds none open
2. someone else files a repair against the same item
3. the conversion commits

The conversion's transaction reads the *item*, not the repair collection, so it
cannot detect this. Firestore transactions guard documents the transaction
touched, and adding the repair collection to that set is not something a
transaction can express — there is no document to read whose absence means "no
open repair exists".

Closing it properly needs either a counter on the item that maintenance writes
transactionally, or a server. The counter is real work and touches the
maintenance write path, which this phase is not opening; a server is off the
table on Spark. So the race is left open and written down. The window is a few
seconds, both actors are staff of the same department, and the outcome is a
recoverable data-quality problem rather than a loss: the repair still exists and
still names the item, it simply describes a quantity the item no longer tracks
that way. With no real user data yet, this is an acceptable trade for the phase.

### 71. A unit's owning team is its own

Phase 11A copied the parent's `team_id` onto every unit and froze it, on the
assumption that an item's units all belong to one crew. Browser QA showed the
assumption is wrong: Lighting's clamps and Scenic's clamps are the same catalog
entry and different property.

So `inventory_units.team_id` is now the authoritative owning team, settable per
unit and changeable afterwards. `organization_id` and `inventory_item_id` stay
immutable copies; only the team moved.

The parent item keeps its `team_id`. Renaming it to `default_team_id` was
considered and rejected — it is a required field on every existing item, read by
the list, the filters, the AI context, and the Rules for items, and renaming it
would touch all of them to express something a comment already says. For a bulk
item it means exactly what it always did. For a serialized item it is the default
a new unit starts from, and it is no longer *presented* as the ownership of every
unit, which was the actual problem.

### 71a. What a serialized parent may claim, and what it may not

`location`, `last_inspected_at`, `team_id`, and `updated_at` describe one
physical object. A serialized item is a grouping of many, each with its own, so
the list and the detail stop showing them for serialized items rather than
showing a value that speaks for equipment it does not describe.

`updated_at` is the least obvious of the four and the most quietly misleading: it
moves whenever *any* unit does, so a clamp untouched since spring reads as
updated this morning because someone else's clamp came back from repair. It stays
in the schema — Rules require it on every write — and is simply not presented. `itemPresentation()` is the single
place that decides, so the list and the detail cannot drift apart.

The fields stay in the schema and stay required. Removing them would break every
bulk item, and a serialized item still needs somewhere for a new unit's location
to default from. Recommendation for a later phase, if it ever matters: leave them
alone. The cost of the current arrangement is one comment; the cost of a rename
is a migration.

Serialized items show a lifecycle summary instead — total, available, in use, in
maintenance, lost, unusable on hand — with the condition breakdown kept as it
was, and the units themselves underneath.

### 71b. Moving a unit between crews is a change of security boundary

`team_id` is what authorizes writes to a unit, so Rules treat a move the way they
treat an item's: editable as it stands, and editable where it is going. A member
must hold both the current and the new team; an Admin may assign any team in the
organization. `teamBelongsToOrganization` rejects a team that does not exist,
the same check an item's team gets.

That read is charged per distinct team in a batch, and
`tests/rules/inventory-unit-transactions.test.ts` measures the ceiling at **eight
distinct owning teams** per batch — comfortably above what a conversion needs,
because the drafts default to the parent's single team and per-unit exceptions
are made afterwards as single-document edits with their own budget. Two hundred
units under one owning team commit fine.

One consequence worth stating: adding or editing a unit also writes the parent's
mirrors, and that write is authorized against the *parent's* team. So the crew
that owns the item manages its unit roster, even where individual units belong to
other crews. That is a defensible split — the item is Lighting's catalog entry
and Lighting curates it — but it is a real constraint rather than an oversight.

### 72. Phase 11C — lifecycle actions

Recorded here so the next phase starts from a settled contract. Units must get
explicit lifecycle actions, not a status dropdown:

- Available → Mark as In Use, Mark Lost
- In Use → Check In, Mark Lost
- Lost → Mark as Found
- In Maintenance → reached through the maintenance workflow, never generic edit
- Retired → reached through an explicit Retire action, never generic edit

Each action updates the unit, the parent's mirrors, and `asset_events` in one
transaction.

Phase 11C should also extend Add Unit so a newly registered asset may start as
Available, In Use, or Lost — In Use requiring a using team, member optional. It
must still not start as In Maintenance or Retired, for the reason in decision
68c. Phase 11B keeps Add Unit available-only.

Phase 11B exposes lifecycle read-only: the summary on the item, a status on every
unit row, and a status on the unit page.

### 73. A serialized item's mirrors are writable by any inventory editor

Decision 71 made a unit's team its own and left a contradiction behind: adding or
editing a unit also writes the parent's counts, and that write was authorized
against the *parent's* team. So Scenic could own a clamp under a Lighting-owned
item and still not be able to record that it broke. Browser QA found it, a Rules
test reproduced it, and it is not acceptable — ownership that cannot be acted on
is not ownership.

Item updates now take one of two paths, chosen by what the write actually
changes:

- **Mirror-only** — `unit_counts`, `quantity_total`, `quantity_available`,
  `condition_counts`, `updated_at`, with the item serialized on both sides.
  Authorized by an active membership with `inventory: edit`, no team required.
- **Everything else** — unchanged. Editable as it stands and editable where it is
  going, exactly as before, which is the whole of bulk behavior and all
  serialized metadata.

`changedOnly()` is what separates them, the same helper the admin transfer and
rename rules already use. Name, category, notes, team, location, tracking mode,
identity, and authorship are all outside the mirror path: a unit owner can move
the numbers their unit moved and nothing else.

The cost is real and worth stating: any inventory editor in the organization can
write a serialized item's counts. Rules cannot count documents, so they could
never confirm those numbers match the units — what they still enforce is that
whatever is written adds up. A malicious editor could write internally
consistent but wrong counts, which is the same thing a team-scoped editor could
already do to their own items. The gain is that legitimate cross-team ownership
works at all.

Promotion is deliberately *not* on this path: it changes `tracking_mode`, so it
takes the ordinary branch and still requires the item's team. Converting an item
is an item-level decision.

### 73a. The expression budget, and what it forced

Adding the mirror path pushed the item update rule past Firestore's limit of
**1000 expressions evaluated per request** — a legitimate rename by the item's
own team started failing with an evaluation error rather than a denial. Two
changes brought it back under:

- the two paths are a ternary rather than an `or`, so only one arm is evaluated
- the second `canWriteInventoryForTeam` runs only when the team is actually
  moving, which is the uncommon case

This limit is separate from the twenty access calls and is easy to mistake for a
permission bug, because that is exactly what it looks like from the client.

### 73b. Owning-team existence: no more eight-team ceiling

Decision 71b checked every unit's owning team against its team document. That
cost one access call per distinct team and capped a conversion at **eight**
crews — an arbitrary product limit nobody could have predicted, working directly
against the promotion wizard's whole point of allowing per-unit ownership.

The check is gone, and the guarantees are split the way `using_team_id` already
splits them:

- **Member** — `canWriteInventoryForTeam` requires the team to be in their
  membership's `team_ids`, and that document is read to authorize the write
  regardless. Free, and it is the real boundary: a member cannot assign a unit
  to a crew they are not on.
- **Admin** — Rules require a non-empty string; the service checks the team
  against the organization's real teams before writing. An Admin already has
  full inventory authority, so a bad team id is a data-quality problem rather
  than an escalation.

Measured after the change: 200 units across 12 distinct owning teams commit in
one batch, and the ladder from 1 to 12 has no failing rung.

### 74. Lifecycle is a set of actions, not a status field

A unit's status is never edited. It changes because something happened to the
equipment, and each of those things is a named action with its own consequences:
taking it out records who has it, checking it in ends that, losing it keeps it in
the inventory as missing, retiring it takes it out for good.

`canTransition` describes the shape of the lifecycle. `offeredTransitions`
describes what the application currently knows how to *do*, and it is
deliberately narrower — the unit page builds its buttons from it, so a button
cannot appear for a move the service would refuse. The gap is maintenance
(needs a repair record, decision 68c) and retiring a unit that is out.

| From | Offered | Not offered, and why |
|---|---|---|
| Available | In Use, Lost, Retire | Maintenance — no repair record yet |
| In Use | Check In, Lost | Retire — get it back or report it lost first |
| Lost | Found, Retire | — |
| In Maintenance | nothing | the repair workflow owns it |
| Retired | nothing | terminal |

### 74a. The arithmetic is one function, not five

Every lifecycle move does the same thing to the parent's numbers: the unit
leaves one bucket and enters another. `bucketOf` already knows which bucket a
unit belongs to from its status and condition together, so `withStatusChanged`
computes the before and after and moves one unit between them.

Five hand-written sets of increments is where an arithmetic bug would hide, and
the condition-dependent cases are exactly the ones that would be got wrong. An
unusable unit on the shelf sits in `unusable_on_hand`, not `available` — so
marking it lost leaves the available quantity alone, and a found unusable unit
does not become available again. Both fall out of the same rule rather than
being remembered separately.

Retirement is the one move that also changes what the active totals cover: a
retired unit leaves the condition breakdown and the item's quantity.

### 75. Asset events: append-only, and not the source of truth

`asset_events` records what happened. The unit document remains authoritative
for what a unit *is* — current state is never replayed from the log, which is why
events carry only the fields a history line needs rather than a snapshot of the
whole unit.

Five verbs: `marked_in_use`, `checked_in`, `marked_lost`, `marked_found`,
`retired`. Renaming a unit, moving it on a shelf, or fixing a note produces no
event; those are corrections to a description, not things that happened to the
object.

The borrowing team and member are copied onto the event because the unit is
about to stop recording them. After a check-in the unit says nothing about who
had it, and "who had this when it went missing" is precisely the question this
collection exists to answer.

### 75a. Rules tie an event to the unit it claims

`assetEventMatchesUnit` reads the unit's *post-transaction* state with
`getAfter()` and requires the event's `to_status` to match, the parent link to
agree, and the actor to have authority over the unit's owning team. An event
therefore cannot claim a move that did not happen, cannot be filed against
another crew's equipment, and cannot be back-filled for a unit nobody touched.

Measured against the real three-document transaction — unit, parent mirrors, and
event in one batch — this fits within both the access-call budget and the
1000-expression limit that bit in decision 73a. `getAfter` on the same path is
charged once no matter how many times the rule reads it.

Events cannot be updated or deleted by anyone, including an Admin. A history
that can be corrected is not a history.

### 75b. What Rules still cannot check

That the parent's mirrors match the units. Rules cannot count documents, so the
transaction is what keeps them honest, exactly as in decision 66. Rules verify
that whatever is written adds up and that the event agrees with the unit.

### 76. Acting on state that moved underneath

The transaction re-reads the unit and refuses if its status is no longer what the
page was showing. Without that check, pressing Check In on a stale page could
perform a Mark Found instead — a different move, recorded under the wrong verb.
The user is told to reload rather than having something else done on their
behalf. A test drives this case directly.

Event ids are allocated before the transaction opens, for the reason proven in
decision 68b: a contended body runs again, and an id generated inside it would
append a second event for one action.

### 77. Registering an asset is not acquiring one

Add Unit now accepts Available, In Use, or Lost. A clamp being entered into the
system may already be out with a crew or already missing, and saying so is more
honest than filing it as available and immediately checking it out.

In Maintenance and Retired stay out, for the reasons in decisions 68c and 74.
Bulk Generate remains available-only: a numbered run of new equipment is new
equipment, and per-unit exceptions are edited afterwards.

### 78. Lost equipment on the dashboard

Counted from `unit_counts.lost` on the item summaries the dashboard already
loads. No unit query, no new collection read. Bulk items contribute zero because
a quantity cannot go missing — only a named piece of equipment can — and
inventing a "lost quantity" for them would be a number nobody recorded.

### 79. Using team is not owning team

Who may act on a unit follows its **owning** team, which is the security boundary
Rules enforce. Borrowing does not confer authority: a Lighting member does not
gain the ability to mutate Scenic's clamp merely because Lighting has it.

Naming a borrowing team is a claim about that crew, so decision 69 still applies
— a member may only name teams they belong to, and an Admin may name any. The
Scenic-owned, Lighting-used loan is performed by an Admin or by somebody on both
crews.

### 80. A lifecycle move cannot happen without its history

An integrity audit found three ways to bypass the log by writing to Firestore
directly. All three were real, all three are closed, and each was proven with a
failing test before the fix.

**A unit's status could change with no event at all.** The unit rule had no
opinion about history, so a well-formed direct write moved a unit and left no
trace.

**An event could be fabricated on its own.** The rule checked only
`getAfter(unit).status == to_status`. A standalone write changes nothing, so a
unit already `in_use` satisfied an event claiming it had just gone out.

**Forbidden transitions went through.** Rules never checked the transition
model, so a direct write could bring a retired unit back or move one out of
maintenance without the repair workflow.

The fix is a linkage field, `inventory_units.last_lifecycle_event_id`, and it is
needed because Rules cannot search a collection: they cannot ask "is there an
event for this move", so the unit has to name one. The two rules then hold each
other up:

- a unit whose status changes must name a **new** event which exists after the
  batch, is about this unit, and whose `from_status`/`to_status` are exactly the
  statuses the unit is moving between
- an event may only be created when the unit's status **before** the batch
  matches its `from_status`, the status **after** matches its `to_status`, and
  the unit points back at this event

Neither can exist without the other, and neither can describe a move that did
not happen. Rules also now enforce the transition model itself, so a retired
unit stays retired however the write is sent.

### 80a. What the linkage does not touch

`last_lifecycle_event_id` is optional. A unit that has never moved does not have
one, and that includes a unit registered while already out or already missing —
decision 77 calls that a description of an existing asset rather than a
transition, and inventing an `available → in_use` history for it would be a
fabrication of exactly the kind this audit exists to prevent.

An edit that leaves the status alone must leave the field alone: Rules require
it to be unchanged when the status is unchanged. So asset code, condition,
location, last inspected, notes, and owning team are all edited exactly as
before, with no event and no ceremony.

### 80b. What it costs

Measured on the real three-document transaction, for both a member and an
Admin, across in-use, lost, and retired, and over two chained transitions. All
within the access-call and 1000-expression limits. Every added read is a
`get`/`getAfter` on a path the batch already touches, and repeated reads of one
path are charged once — the same property that made the batch measurements in
decisions 66 and 75a come out well.

### 81. "Active", not "Total"

Retiring a unit takes it out of `active_total` while its document stays in the
list for its history. Labelling that number "Total" meant a reader could count
more rows than the total claimed — the numbers were right and the word was
wrong. The serialized summary now says **Active**, and shows **Retired**
separately when there is anything to show. No mirror semantics changed, and no
unit is hidden to make a number agree.

### 82. Repairs name the equipment, once there is equipment to name

A bulk repair records a quantity — four of the twenty-four clamps went out, and
which four was never written down. That stays exactly as it was: bulk items keep
`quantity_sent`, keep `planned`, and keep their existing workflow untouched.

A serialized repair names the pieces. `maintenance_records` gains
`tracking_mode` and `unit_ids`, and `quantity_sent` mirrors the list so
everything that already reads it keeps working.

### 82a. A serialized repair starts at `sent`

There is no `planned` stage for individually tracked equipment. A planned repair
holding a list of units would be a reservation, and two planned repairs could
name the same clamp — which needs locking infrastructure this project has no
business building. The record exists because the equipment left, so it starts
where that puts it.

Bulk repairs keep `planned`, because a bulk quantity is not taken from anywhere
until it goes.

### 82b. Only from the shelf

A unit enters maintenance from `available` and nothing else. Equipment that is
out gets checked in first, something lost gets found first. Each of those is a
lifecycle move with its own history, and letting a repair perform one silently
would be a shortcut around exactly the record this phase exists to keep.

Condition is not a factor either way. A clamp in perfect condition can go for a
service, one marked unusable is what a repair is for, and coming back is not a
claim that anything was fixed — condition never changes automatically, in either
direction.

### 83. One event for the batch, because six units was not enough

The per-unit lifecycle event of decision 75 costs one document read per unit:
the unit reads its event and the event reads its unit. Measured against the
published rules, a batch ran out of access calls at **six units**. Sending ten
clamps for repair is an ordinary afternoon in a school theatre, so that was a
blocker rather than a limitation.

A maintenance batch now shares one event. Every unit names the same document, and
Rules charge for distinct documents rather than for each reference — so the cost
stops growing with the batch. Measured after the change: **200 units, for a
member and an admin alike, including a batch split across two crews**. Two
hundred is the declared cap, not the ceiling; the budget had room above it.

### 83a. What holds the batch together

Four documents have to agree, and each is checked against the others:

- every **unit** proves it is listed in the event, that the event describes its
  exact move, and that it names the same repair the unit now points at
- the **event** is checked against the record it names, and against one unit
  that really did move
- the **record**'s `quantity_sent` must equal its `unit_ids`, which must contain
  no repeats, and is immutable once written
- the **parent item**'s `in_maintenance` count must move by exactly the size of
  the list — up when the equipment leaves, down when it returns, and not at all
  for a workflow step in between

That last one is what closes the interesting hole. Rules cannot count how many
unit documents a transaction touched, but every unit entering maintenance raises
that bucket by exactly one, whatever condition it is in. A record claiming fifty
units while one moves produces a delta of one against a list of fifty, and is
refused.

### 83b. What Rules still cannot prove

An inventory editor who falsifies **all four documents consistently** — the
units, the parent counts, the record, and the event — is not stopped. This is
not perfect integrity and should not be described as such.

It is, however, the same trust boundary this project already accepted for
client-maintained serialized mirrors in decisions 66 and 75b: Rules check that
stored numbers are internally consistent and cannot check that they match
reality. The strengthened checks bring maintenance inside that existing boundary
rather than opening a new one, which is why it is accepted here. There is no
server; on Spark there cannot be.

### 84. A unit carries its own repair history

`inventory_units` gains two fields, and they do different jobs.

`current_maintenance_record_id` is current state: set when the equipment leaves,
required exactly while `status == 'in_maintenance'`, and removed when it comes
back. The unit page reads the repair by id — no query, no index.

`maintenance_record_ids` is history: append-only, one entry per visit, added at
the moment the equipment leaves and never touched again. Rules enforce that a
status change into maintenance appends exactly one entry, that returning leaves
the list alone, and that no ordinary edit may add, drop, reorder, or repeat
anything in it.

The alternative was to find a unit's repairs by searching events for ones whose
array claims it. That would have shown the user history the rules cannot vouch
for — precisely the thing decision 83a exists to prevent — and needed a
composite index besides. A unit that names its own repairs needs neither.

### 85. Which number says how much equipment is away

`Currently In Service` reads from two places on purpose:

- **bulk** items: the repair records, exactly as before, because a bulk quantity
  is not counted anywhere else
- **serialized** items: `unit_counts.in_maintenance` on the item, because the
  equipment counts itself

Serialized repair records are excluded from the record-based half, or the same
clamp would be counted twice. The effect is that a malformed repair record
cannot inflate the dashboard: the equipment's own state wins.

`Active Repairs` stays record-based. It counts repair jobs, not pieces of
equipment, so none of this touches it. The Lost KPI is unchanged.

### 86. All at once, or not at all

Phase 11D has no partial return. Every unit on a repair comes back together, on
`returned` or on `cancelled`. A record that is half returned cannot say which
half, and the parent-delta check that keeps the batch honest depends on the whole
list moving.

Changing which equipment a repair took means cancelling it and sending a new
one. `unit_ids` is immutable from the moment the record exists, because rewriting
it would rewrite what happened while the units' own histories still said
otherwise.

### 87. Recording a repair is not the same as starting one

Decision 82a said a serialized repair does not start as `planned`. The
implementation read that as "always create it as `sent`", which is a different
and wrong thing.

Microphones sent to the shop on Monday might not be entered into the app until
Wednesday, by which time they are already being worked on. Forcing the teacher
to file that as Sent and then click through to In Service asks them to type
something untrue and then correct it.

So a serialized repair may be recorded at **sent**, **in_service**, or **ready** —
any stage where the equipment is away. It still may not be recorded as
`planned` (the equipment has gone) or as `returned`/`cancelled` (a repair that
is over has nothing to record).

The stage changes nothing about the equipment. All three mean one thing to a
clamp: it is at the repair shop. The units move `available → in_maintenance`
exactly once, the parent counts move once, the pointer is set once, one entry is
appended to each unit's repair history, and one shared lifecycle event is
written. Every other rule — the parent delta, the unique ids, the quantity
mirror, the permissions — applies identically.

### 87a. `sent_to_maintenance` still reads correctly

The shared event keeps its name even when the record is created as In Service or
Ready. It describes the unit transition, not the paperwork: the equipment
entered maintenance, which is exactly what happened. Renaming it would touch the
event vocabulary, the Rules, and every existing document for no gain in
accuracy.

### 87b. Advancing a repair is on the list, not just the page

The same discoverability problem as decision 74: the workflow buttons existed
only on the record page, so advancing a repair meant knowing to open it first.
The maintenance list now carries **Manage status** on any serialized record that
still has somewhere to go, beside **View details**.

`maintenanceWorkflowSteps` is the one source for what a repair can do next, read
by the list and the record page alike, so a control offered in one place cannot
be missing or different in the other. Finished repairs offer nothing, bulk
repairs keep their existing behaviour entirely, and there is no editable status
dropdown anywhere — returning or cancelling moves a whole batch of equipment and
has to stay an explicit action.

### 88. Planning a repair is not a state the equipment is in

Decision 82a excluded `planned` from serialized repairs, on the grounds that a
plan holding a list of units would be a reservation two repairs could both
claim. That reasoning was about *reservation*, and the fix was to remove the
feature rather than the reservation.

Planning is a real workflow — "we will send these three microphones next week" —
so it comes back, and nothing about it reserves anything.

The two state systems answer different questions and are kept apart:

- **Unit lifecycle** answers *where is this piece of equipment right now*
- **Maintenance status** answers *what is happening with this repair*

They coexist. A microphone can be In Use and planned for maintenance at the same
time, and that is not a conflict — it is Monday's plan and Tuesday's rehearsal.
It can even be Lost and planned, which is a problem for the teacher rather than
for the model.

So there is no `planned_maintenance` unit status, no reservation, no lock, and
no lifecycle action is taken away because a plan exists. The status badge keeps
saying what the equipment actually is; the plan is a quieter second line under
it.

### 88a. The pointer, and why one at a time

`inventory_units.planned_maintenance_record_id` is a single optional field. A
unit may be in at most one open plan, and Rules refuse a second while the first
is there.

An array would allow a microphone to sit in three overlapping plans, which is
not a workflow anybody wants and would need real scheduling to make sense of. A
single pointer makes "already planned" a structural fact the UI can show and the
rules can enforce, without inventing reservation infrastructure to prevent it.

The field is metadata. It does not imply unavailable, reserved, or checked out.
It exists so a unit page can say "planned for maintenance" and link to the plan —
which matters more once QR labels arrive and one scan has to explain everything
about a piece of equipment.

### 88b. Availability is checked when the repair starts, not before

This is the consequence of not reserving. A plan can be created over a
microphone that is currently out, and starting that repair later can therefore
fail — which is correct, and reported by name:

> 2 planned units are not currently available: MIC-002 — Out with a crew, check
> it in first, MIC-007 — Missing, mark it found first. Check them in, resolve
> their status, or update the planned equipment before starting this repair.

The start is all or nothing. There is no partial start any more than there is a
partial return.

### 88c. What a plan writes, and what it does not

| | plan create/edit/cancel | start |
|---|---|---|
| unit status | unchanged | `available → in_maintenance` |
| parent counts | unchanged | move by the batch size |
| `current_maintenance_record_id` | never | set |
| `maintenance_record_ids` | never | appended once |
| `asset_events` | none | one shared event |
| planning pointer | set / moved / cleared | cleared |

A plan is not repair history: `maintenance_record_ids` gains an entry when the
equipment actually leaves, so a plan created and cancelled leaves no trace on the
unit at all. Rules enforce every row of that table — a plan write must show a
parent maintenance delta of exactly zero.

### 88d. What the planning pointer can and cannot be trusted to say

Rules prove that a unit's pointer names a plan that exists, is still planned, and
lists that unit; that taking a pointer requires the plan to be written in the
same batch; that a unit cannot hold two; and that ordinary edits and lifecycle
moves cannot add, drop, or change one. Normal lifecycle transitions carry it
through untouched, which is what keeps In Use and planned coexisting.

What they do not prove is that every unit a plan lists actually points back. A
plan could name a unit that was never written, and that unit would simply not
show the indicator — a display gap, not a correctness one, and it corrects itself
when the repair starts, because starting writes every listed unit. This is the
same shape of limitation as decision 83b, and smaller, because a plan moves no
equipment.

### 88e. Editable while planned, settled once started

`unit_ids` may change while a repair is still a plan — units added, removed, or
swapped — because nothing has been taken yet and the list is still a decision.
The moment the repair starts it becomes a record of what left, and Rules make it
immutable from then on, as decision 86 already required.

### 89. A QR label is a link, not a credential

The QR printed on a piece of equipment encodes exactly one thing: the path
`/equipment/<unit document id>` on the deployed origin. It carries no token, no
signature, no organization identifier, and nothing about the equipment itself.

Everything an authorization decision needs is already in Firestore. A URL that
carried more would be a second, weaker copy of it — one that travels on a sticker
that leaves the building, gets photographed, and cannot be revoked. Anyone who
opens the link still signs in, and still sees the unit only if Security Rules say
their membership allows it. A label is a shortcut for someone who already has
access, not a way to obtain any.

That is also why nothing about the equipment is encoded. A code that spelled out
the asset code, the item, or the organization would tell a stranger holding a
lost microphone which school to sell it back to.

### 89a. The identity is the document id, not the asset code

Asset codes are edited. Crews renumber, correct typos, and adopt new conventions,
and a serialized item's codes are the field most likely to change over the life of
the equipment. A sticker printed from an asset code would quietly stop working on
the day somebody fixed a typo, and there would be no way to notice except by
scanning it.

The unit document id never changes, so a label printed once is correct for as
long as the unit exists — through a rename, a change of owning team, a repair, a
loss, and retirement. Nothing in the lifecycle touches identity, which is what
makes "print once" true rather than aspirational.

### 89b. The origin is a constant, not the current browser location

`publicAppOrigin()` returns a compiled-in constant. It never reads
`window.location`, because a label generated during development on
`localhost:5173` would then be printed, stuck to a microphone, and be permanently
useless to everyone including the person who printed it.

`VITE_PUBLIC_APP_ORIGIN` can override it for a different deployment, but it is
optional and non-secret: with nothing set, the production origin is used from
every environment, including local development. No `.env.local` change is needed
to print a correct label.

The override is validated before it is used, and anything questionable is
discarded in favour of the default rather than printed. It must be an absolute
`https:` URL with a host and nothing else — no other scheme, no credentials, no
path, query, or fragment. A sticker cannot be recalled, so a typo in
configuration should cost a wrong deployment origin at worst, never a
`javascript:` URL in a code that somebody's phone offers to open, and never a
label that fails to resolve.

### 89c. Denied and absent are the same answer, on purpose

Rules gate a unit read on `resource.data.organization_id`, and a document that
does not exist has no `resource` — so the read is denied rather than returning an
empty snapshot. This is verified in `tests/rules/equipment-scan.test.ts` rather
than assumed.

The consequence is that a client genuinely cannot distinguish "this equipment
does not exist" from "this equipment is not yours", and the interface says one
thing for both. That is not vagueness for its own sake: distinguishing them would
let anyone with a scanner and a guessed id confirm which units are real, one
request at a time, without belonging to any organization.

### 89d. A scanned label may belong to another of your organizations

A person can be in several organizations, and the active one lives in the
browser. Scanning a label from organization B while organization A is open is
ordinary, not an attack.

Rules decide from the unit's own `organization_id`, not from whatever the browser
has open, so the read either succeeds — proving membership and inventory access
in the owning organization — or is denied. When it succeeds against a different
organization, the page offers to switch rather than claiming the equipment was
not found. The switch is offered rather than performed, because the active
organization is global and changing it silently would move every other page the
person has open.

Switching does not navigate. The route stays exactly where the label pointed and
the page re-resolves, so the person lands on the equipment rather than on a
dashboard they then have to find it from. The same is true after signing in and
after choosing an organization: the destination is carried through all three (see
decision 89f for why the route can sit where it does).

### 89e. What a printed label says, and what it refuses to say

A label carries the QR, the asset code, the item name, and the organization name.
It carries no status, condition, storage location, owning team, holder, repair, or
notes.

Every one of those changes while the sticker stays where it is. A label reading
"Available" on a microphone that has been missing for a month is worse than a
label saying nothing, because somebody will believe it. Anything that moves lives
on the page the QR opens, which is current by construction.

### 89f. One route sits outside the active organization's guards

Every other page in the application knows which organization it belongs to before
it loads. `/equipment/:unitId` does not: a QR carries a unit id and nothing else,
and which organization owns that unit is a fact stored in the unit.

Leaving the route under `OrganizationGuard` and the inventory `PermissionGuard`
therefore refused legitimate scans. Someone in two organizations, whose active
one gives them no inventory access, scanning a label from the organization where
they do have it, was stopped before the page could read the unit and find out.
The guard was answering a question about the wrong organization.

So this one route was moved to sit directly under `AuthGuard`, still inside
`AppShell`. Nothing else moved, and `src/routes/routes.test.tsx` walks the real
route tree to keep it that way — it fails if the equipment route is re-nested,
and equally if any other route wanders out.

Nothing is given away by the move. The guards only ever decided what to render;
Security Rules decide what may be read, and they are unchanged. A successful unit
read already proves membership and inventory access in the owning organization,
because Rules evaluate `resource.data.organization_id`. A failed one yields the
generic message of decision 89c. `tests/rules/equipment-scan.test.ts` proves both
directions against the emulator, including the split-access case the exception
exists for: inventory access in the unit's organization opens it whatever the
browser has open, and inventory access in the open organization opens nothing
that belongs to another.

What the move does cost is the `UnassignedPage` an unassigned member used to see
here. They now get the generic unavailable message instead, which is accurate —
Rules deny them the read — but says less about why. A worthwhile trade for a
route whose whole purpose is to be reachable from a sticker.

### 89g. The print sheet is never opened from inside a modal

The label sheet is portalled to `document.body`, because the print stylesheet
hides every top-level element except the sheet — nesting it in the application
shell would either print the sidebar or hide the sheet along with its parent.

That has a consequence which cost a working batch print. An open Radix modal
sets `pointer-events: none` on `body` and re-enables it only for its own layers,
so anything else portalled alongside it inherits the lock. The batch dialog
originally rendered the printer as its own sibling: the sheet appeared, its Print
button could not be clicked, and the click fell through to the dialog's overlay,
which dismissed the dialog and unmounted the printer with it. Nothing printed,
and it looked exactly like Cancel.

So the selection dialog no longer prints. It prepares the sheet while the units
and the selection are still in hand, hands it over whole, and closes; the page
owns the printer and opens it with nothing modal above. That is the same path the
single-label button on Unit Detail always took, which is why that one worked
throughout — there is now one print mechanism rather than two.

The print root also sets `pointer-events: auto` for itself. Not a workaround for
the above, which is fixed by structure: it covers the one close animation during
which the departing dialog's lock is still on `body`, and it stops the same trap
from being re-set by anyone who later opens the printer from somewhere new.

### 89h. One return path, agreed on by everything that redirects

A scanned label survives sign-in only if every component in the chain agrees on
what a stored destination looks like. `src/routes/return-to.ts` is that
agreement: `locationToReturnPath` reduces a router location to
`pathname + search + hash`, `safeReturnPath` validates that string, and
`afterAuthDestination` answers "where does somebody who just signed in belong".

Three redirects use it — `AuthGuard` on the way to sign-in, `GuestGuard` on the
way back, and the sign-in screen itself — and organization selection uses the
same validator.

`GuestGuard` is the reason this had to be centralised rather than left to the
sign-in screen. Its job is only to keep signed-in people off the login form, but
it re-renders the instant authentication succeeds, while the sign-in screen is
still mounted, and mounts a `<Navigate>` whose effect lands after that screen's
own redirect. It was sending everyone to organization selection, so a deep link
that had been carried correctly all the way through sign-in was discarded at the
final step. Making the two disagree less was not an option; making them ask the
same function was.

The destination is a string, never a `Location` object. An object reads perfectly
well at the storing end and is silently discarded by the validator at the far
end, which is exactly the kind of mismatch that loses a destination between two
components that each look correct.

### 89i. With no organization open, the unit's own is opened

Decision 89d switches organizations only on an explicit click, because the active
organization is global and moving it would move every other page and tab.

None of that applies when nothing is open. Signing out clears the stored
organization, so the ordinary end of a scanned label — scan, sign in, arrive — has
no active organization at all, and asking which organization the equipment in the
person's hand belongs to would be a question with one answer that the application
has already read and authorized.

So that case opens the unit's organization directly and stays on the route. The
explicit card remains for the case it was written for: a *different* organization
already open, where switching costs the person something elsewhere.

### 90. Money is whole cents, and one currency

Every amount is an integer number of cents. `0.1 + 0.2` is not `0.3`, and
`1.15 * 100` is `114.99999999999999` — a budget that is wrong by a hundredth of a
cent per row is a budget nobody trusts, and one that silently rounds a price down
stops matching the quote it came from. Cents are exact under addition and under
multiplication by a whole quantity, which is all the arithmetic this feature
does. `parseMoneyToCents` reads the digits a person typed rather than parsing a
float and scaling it.

One currency, US dollars, for the whole product. An organization-level currency
setting would solve nothing here: a school theater program plans in the currency
it buys in, and a second one would bring conversion rates, a rate date, and a
rounding policy without answering any question the program has. Formatting is
built from the digits — `$1,250.00` — so it does not vary with the browser's
locale.

The ceiling is $1,000,000.00 for one unit, enforced in Rules as well as in the
form. Three orders of magnitude above the most expensive thing a school theater
buys, so it never obstructs real data, and low enough to catch a misplaced
decimal point or a paste of the wrong field before it reaches a budget. It also
keeps `quantity × unit cost` far inside exact integer range.

None of this is accounting. No purchase history, no depreciation, no ledger, no
payments. Every label says "estimated", because that is what these numbers are.

### 90a. Cost belongs to the item, not to each unit

`inventory_items.unit_cost_cents` is optional and means what one quantity unit
would cost to replace. Serialized units inherit it for estimation and carry no
cost of their own.

Whether one microphone was bought for more than another is purchase history, and
this product deliberately keeps none. Duplicating a cost onto every unit would
create a field that has to be maintained per unit, drifts from its parent, and
answers a question the MVP does not ask.

Absent means unknown, and unknown is never rendered as `$0.00`. An unpriced
catalog would otherwise report a program's entire inventory as worth nothing,
which is a claim rather than a gap. Presence is tested rather than truthiness
throughout, so an item somebody deliberately recorded as free stays distinct from
one nobody has priced.

### 90b. Estimated inventory value, not book value

Item Detail shows `active quantity × unit cost`. Retired units are excluded: they
are kept for their history and are not something the program still has, so
counting them would overstate what replacing the inventory costs. For a
serialized item the number comes from `unit_counts.active_total` — the units are
the source and the parent's `quantity_total` is the mirror.

It is called Estimated Inventory Value and never Book Value or Asset Value.
Nothing is depreciated, nothing records what was paid, and no purchase date
exists.

### 90c. One stored number per action, and the total is derived

`action_items.estimated_unit_cost_cents` is optional. The line total is the
existing `quantity` times that, computed wherever it is shown and never stored —
two independently editable numbers would drift the first time somebody changed
one, and there would be no way to say which was right.

The production total is derived the same way, from the action items, on every
read. There is no `production.total_cost` field and no persisted summary. This is
the same rule that already governs shortage, condition summaries, and dashboard
counts.

### 90d. Done counts, cancelled does not

The production estimate counts actions that are `todo`, `in_progress`, or `done`,
and excludes `cancelled`.

A production that has already bought the cable still had to pay for it. Dropping
completed work would make the budget shrink as the season progressed, which is
the opposite of what a budget is for. Cancelled work was decided against and cost
nothing. A cancelled action with no estimate is not counted as a missing estimate
either — it is not part of the question.

### 90e. Unknown costs are reported, never counted as zero

An action with no estimate contributes to a missing count, not to the total, and
the interface says so beside the number: the heading reads "Known estimated cost"
rather than "Estimated production cost" whenever anything is missing, and a note
names how many are absent.

Silently treating unknown as zero would produce a total that looks complete and
is not, and somebody would plan against it. This is the single most important
behaviour in the feature, and it is tested from both directions: the dollar total
is unchanged by adding an unestimated action, and the missing count moves.

### 90f. Buy may borrow the shelf price, once

Creating a Buy action for a matched requirement prefills the estimate from the
inventory item's `unit_cost_cents`. What the shelf costs to restock is what
buying more costs, so the suggestion is usually right and saves typing.

It is a snapshot, exactly like the action quantity that defaults from the
shortage and then belongs to the user. Editing the inventory item's cost later
never rewrites an action's estimate: the action records what the crew planned,
and a price that changed in March does not change what was budgeted in January.

Rent, Build, and Repair get nothing. A week's rental, the lumber for a build, and
a shop's repair charge are different questions the shelf price cannot answer, and
a confident wrong number in a budget is worse than a blank somebody has to fill
in. Switching an untouched suggestion from Buy to Rent withdraws it rather than
silently re-labelling it; anything the user actually typed survives the switch.

### 90g. Cost carries no new permission

Inventory cost follows the inventory permission, and action estimates follow the
production permission. No finance role, no separate visibility flag: someone who
can see the inventory can see what it costs to replace, and someone who can plan
a production can price the plan.

Rules validate both fields as optional non-negative integers within the ceiling.
An optional field nobody checked would be a place to write anything at all —
`hasExactly` would happily accept a string, a float, or a negative number as
"the cost" once the key was allowed.

### 90h. Nothing to migrate

Both fields are optional. Every existing item and action has neither and keeps
working untouched, reading as "Cost unknown" until somebody edits it. No
migration, no backfill, and specifically no bulk write of zeroes — which would
replace an honest gap with a false number across the whole catalog.

Maintenance records gain nothing here. A maintenance record is the physical
repair workflow; an action item of type Repair is a production planning task.
"Repair 2 microphones, estimated $150" is a line in a production budget, and the
service provider's invoice is not something this product tracks.

### 90i. Technical debt: maintenance cost is still float dollars

`maintenance_records.cost` predates the money model. It stores dollars as a
floating-point number — the form sends `Number(input)` from a `step="0.01"`
field, the page renders `cost.toFixed(2)`, and Rules check only
`is number && >= 0`. It was introduced with maintenance management and is
untouched by Phase 11F.

So "all stored money is whole cents" is true of what Phase 11F added and not yet
true of the product as a whole. Recording that plainly rather than letting the
claim stand unqualified.

It is left alone deliberately. Converting it means a schema change, a Rules
change, and a migration of existing documents, and Phase 11F was scoped to
production planning rather than to the maintenance workflow — decision 90h keeps
those two apart on purpose. A later cleanup would move it to
`cost_cents`, validate it with the same `isCostCents`, and read the old field
during a transition.

Nothing depends on the inconsistency: the two numbers never meet. A maintenance
record's cost is what a repair shop charged, and an action item's estimate is
what a production budgeted; no total adds them together.

### 91. The scanner stores nothing

A scanning session is client memory and nothing else. No collection, no unit
field, no scan log, no session document.

A scan is an act of looking at equipment. When it changes something, the change
is a lifecycle move, and `asset_events` already records what happened, to what,
by whom, and when — that is the history. A parallel scan log would be a second,
weaker account of the same facts, out of step with the first the moment a scan
failed halfway.

The session therefore ends when the page closes, and the interface says so
rather than implying otherwise.

### 91a. jsQR, and why the decoder is separate from the camera

`jsqr@1.4.0` — Apache-2.0, no runtime dependencies, ships its own types, 280KB
unpacked. It decodes pixels and nothing else, so the camera loop is written here:
`getUserMedia`, a canvas, a frame every 100ms downscaled to 640px on the long
edge, and explicit `track.stop()` on the way out.

That is more code than a library that owns the camera too, and it is the reason
to prefer it. Track cleanup, pausing on a hidden tab, and the decode rate are the
things that actually go wrong on a phone, and here they are visible rather than
behind somebody else's abstraction. The alternatives were 2.6MB and 5.8MB
unpacked and bundle decoders for barcode formats this product has no use for.

`BarcodeDetector` was not used. It is absent from iOS Safari, which is a
mandatory target, so it could only ever be an optimisation on top of a fallback
that has to exist anyway — a second code path to test for a saving nobody would
notice at ten frames a second. It remains available behind the same adapter if
that ever changes.

### 91b. Camera frames never leave the device

Frames are drawn to a canvas in the browser and read by a decoder written in
JavaScript. The only thing that leaves `scanner-camera.ts` is the short string a
QR encodes.

Nothing is uploaded, stored, sent to Firebase, or handed to a third party, and no
frame outlives the tick it was decoded in. There is no remote QR service in this
product in either direction: labels are drawn locally by `qrcode.react` and read
locally by jsQR.

### 91c. Two guards against one sticker becoming two writes

A decoder reading ten frames a second sees the same label dozens of times while
somebody holds a microphone steady. Two separate guards stop that becoming
repeated Firestore writes, because they fail differently.

The session recognises a unit already handled. The in-flight set recognises one
whose write has started and not finished — the case with no result to recognise
yet, where two decodes a few hundred milliseconds apart would otherwise both look
new.

Admission is synchronous, and that is the point. `handleDecoded` checks and
claims in the same turn, before any `await`, so a second decode in the same tick
cannot be admitted. This is why the session lives in a plain closure rather than
in React state: a check against a value React had not re-rendered yet would pass
twice.

Going back to a unit is deliberate. A failed write can be retried through "Scan
again", which forgets the row so the camera may act on it again; nothing retries
on its own, because a unit sitting in frame would retry forever.

### 91d. The scanner performs only the move its mode names

Inspect writes nothing. Check out moves `available → in_use`. Check in moves
`in_use → available`. Every other state produces a warning and no write.

That is narrower than the lifecycle allows, deliberately. `lost → available` is a
perfectly good transition from the unit page, where somebody has read the history
and chosen to mark equipment found — but a check-in sweep must never do it
silently. The person walking a storage room is looking at equipment, not at each
unit's state, and a tool that quietly resurrected lost equipment because it
turned up in the returns bin would be worse than one that stops and says
something. Retired equipment is never reactivated for the same reason.

A planned repair stays advisory, as decision 88 settled: equipment with a plan
attached is still on the shelf, still checks out, and keeps its plan.

Nothing about how a unit moves is reimplemented here. The scanner calls
`performLifecycleAction`, which re-reads the unit inside its own transaction and
maintains the parent's counters, the planned-repair pointer, the repair history,
and the lifecycle event — the Phase 11D linkage regression cannot return through
this path, because this path does not build unit documents.

### 91e. One transaction per unit, and partial results are shown

Scanning is continuous; the writes are not batched. Each unit goes through the
existing single-unit transaction, so a session reads:

```
MIC-001   Checked out
MIC-002   You don’t have permission to update this equipment.
MIC-003   Checked out
```

An all-or-nothing transaction across a shelf would be a new and much larger piece
of machinery, and it would make one unauthorised unit discard work that
succeeded. Per-unit success and failure are both shown; nothing is hidden.

### 91f. A session belongs to the organization it was opened in

Unlike a scanned deep link, which arrives from outside and resolves its own
organization (decision 89f), a scanner session is opened inside one deliberately.

Equipment from another organization is refused with a warning and no write, and
the active organization is never switched mid-session — a sweep is a sequence of
related actions, and moving the whole application out from under it would be
disorienting at best. The unit's page remains reachable, where the existing
switch UX handles it properly.

Authorization is unchanged and unmoved. Inspect needs inventory view; checking
equipment in or out needs whatever the owning team's rules already require. The
using team is not a permission — being the crew borrowing a microphone has never
granted the right to edit it — and no client-side check is trusted: every write
goes to Rules, and a refusal becomes a row in the session saying so.

### 92. Smart Search sees individual equipment, not just the catalog

The AI context was written when inventory was only quantities. It sent one line
per item — "total 10, available 6" — which is the whole truth for a bulk item and
almost none of it for a serialized one. "Where is MIC-017?" had no answer,
because asset codes were not in the request at all, and neither were lost,
retired, or in-maintenance equipment.

The request now carries two blocks. Items keep their line, marked as a quantity
or as a summary of individual equipment. Units get their own block, one line
each: asset code, item, owning team, status, condition, location, who has it,
whether it is away for repair, whether a repair is planned, how many past repairs
it has had.

The equipment block is named as authoritative in the prompt, and the item line
says it only summarizes. Telling the model that a parent's numbers describe each
of its units is the specific mistake this is written to prevent — four
microphones are not one microphone with a quantity of four.

References stay request-local: `I7` for an item, `U3` for a unit. No document id
leaves the browser in either direction, and a reference the model returns that
was never supplied resolves to nothing.

### 92a. The prompt states the domain rules rather than leaving them to be inferred

Availability is not something the model works out. Each equipment line carries
`available yes` or `available no`, computed by the same `isOperationallyAvailable`
the rest of the product uses, and the instruction says to use it — because the
obvious inference is wrong: equipment in `needs_repair` condition is still on the
shelf and still available, and only `unusable` condition or a non-available
status removes it.

The other three the prompt states outright:

- planned maintenance is an intention, not a repair. Equipment with a plan is
  still wherever its status says, and is never added to a count of equipment in
  maintenance.
- retired equipment has left the inventory and is never counted when somebody
  asks what the organization has, unless they ask about retired equipment.
- lost equipment is still active inventory that happens to be missing, which is
  a different thing from retired.

Each of these is a mistake a reasonable reader would make from the field names
alone, which is why they are said rather than assumed.

### 92b. Stored costs may be reported, never invented

Item lines carry `estimated unit cost $18.50` when one is recorded and
`estimated unit cost unknown` when none is. The prompt says to report it when
asked, to say unknown when it is unknown, and never to guess, estimate, or treat
unknown as zero.

The Requirement Generator gets nothing at all. Its schema is a `strictObject`
with no price field, so a model that offers `estimated_unit_cost_cents`,
`price`, or `cost` has that suggestion rejected rather than stripped — the
reviewer never sees a number nobody can stand behind. Salvage is per suggestion,
so one priced row costs that row and not the list.

### 92c. The Dashboard was already right

Phases 11C and 11D left it correct, and this phase changed none of it. Recorded
as tests rather than as changes:

- active counts read `quantity_total`, which for a serialized item mirrors
  `unit_counts.active_total` — retired equipment is already out of it
- "Active Repairs" counts jobs and includes a planned one; "Currently in service"
  counts equipment that has physically gone. The two are allowed to disagree and
  the cards say which is which
- a serialized repair record is excluded from the record-based half, so the same
  microphone is not counted twice
- the dashboard reads items only, never units, so parent and unit cannot both be
  counted

No lost-equipment card was added: `lostUnits` already appears in the attention
area, and a second surface for the same number would be clutter. No financial
KPI was added either — Phase 11F put cost where decisions are made, on Production
Detail and the Action List, and a headline number on the dashboard would invite
reading a planning estimate as a budget.

### 92d. What the AI is still not allowed to do

Unchanged, and worth restating now that it can see more: the AI reads. It writes
nothing. The Requirement Generator drafts a list a person edits and approves, and
`suggested_action` is advice shown in that dialog which does not survive the save
— decision 48 keeps the plan on the Action Item alone.

The context contains only what the user could already read: items and units come
from the same authorized queries the inventory page uses, under the same Rules.
No Rules exception exists for AI, and none was added. Organization notes,
descriptions, and questions are delimited as data in the prompt and named as data
to interpret rather than instructions to follow.
