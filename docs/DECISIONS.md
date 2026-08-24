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
