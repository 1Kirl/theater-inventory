# Theater Inventory Tracker — Roles and Permissions

## 1. Permission Model

Authorization is evaluated within the active organization.

A user may have different roles and permissions in different organizations.

Do not store a global Admin flag on the user profile.

Permissions are stored inside the membership document — `organization_memberships` carries
`team_ids[]` and a `permissions` map. There is no separate `team_permissions` collection and no
per-team permission document. This keeps every authorization decision reachable from a single
membership read, in the client and in Security Rules alike.

**Role is not stored.** It is computed from `organizations.admin_uid` and the membership. See
section 2b.

**There is no trusted server.** Firestore Security Rules are the authorization boundary, not a
second line of defence behind server code. Any invariant that cannot be expressed in Rules is not
enforced.

## 2. Membership Roles

### Admin

Admin has full access to the active organization.

Admin-only capabilities:

- edit organization settings,
- view/regenerate organization join code,
- create/edit teams,
- manage member status,
- assign teams,
- assign permissions,
- transfer Admin role.

Admin also has full access to operational modules.

A user is Admin when `organizations.admin_uid` names them. Administration lives in that one field,
which is what makes "exactly one Admin per organization" structural.

While a user is Admin, access does not consult `team_ids` or `permissions` at all. Those fields are
**kept, not cleared** — they are what determines the user's role again if administration is later
transferred away (section 8).

### Member

A Member has been assigned by an Admin.

Their effective access depends on the permission map in their organization membership.

### Unassigned

A user who joined with a valid organization code but has not been assigned yet.

Default behavior:

- may see organization name and waiting-state page,
- may return to Organization Selection,
- may view personal account settings,
- no access to normal organization data modules.

Promotion to Member is not an event and not a stored value. A membership simply reads as Member
once it satisfies the assignment condition, and as Unassigned when it does not. There is no status
control to forget and no field that can fall out of step with the assignment.

### Deactivated

`is_active = false` on the membership. Treated as no access at all — the same as having no
membership — while preserving the user's historical references. The MVP has no hard delete for
memberships, and the current Admin's membership cannot be deactivated.

## 2b. Effective Role

Role is derived at runtime from two documents the caller can already read:

```
if organizations/{orgId}.admin_uid == uid
  -> Admin

else if membership.is_active == true
     && membership.team_ids.size() > 0
     && at least one of inventory / maintenance / productions / calendar is 'view' or 'edit'
  -> Member

else
  -> Unassigned
```

The second branch is the **assignment condition**. The same expression is evaluated in the client
for the UI and in Security Rules for authorization, so the two cannot drift apart.

Consequences worth stating plainly:

- Transfer Admin writes one field. Both users' roles change because the computation reads a
  different `admin_uid`, not because anything was written to their memberships.
- Removing every team or dropping every module to `none` returns a member to Unassigned with no
  extra write.
- A deactivated membership reads as Unassigned regardless of what it holds.
- The current Admin cannot be deactivated. Rules reject setting `is_active: false` on the
  membership whose uid equals `admin_uid`, so an organization cannot be left without an Admin.

## 3. Permission Levels

Each normal operational module uses one of three levels:

### none

- Module is not shown in normal navigation.
- Direct routes are blocked by route guard.
- Firestore read/write is denied.

### view

- User may read relevant organization data.
- Create/Edit/Delete controls are disabled or hidden.
- Firestore writes are denied.

### edit

- User may read and modify the module according to additional team/data rules.

## 4. Modules

The MVP has exactly four permission modules:

```ts
interface ModulePermissions {
  inventory: 'none' | 'view' | 'edit';
  maintenance: 'none' | 'view' | 'edit';
  productions: 'none' | 'view' | 'edit';
  calendar: 'none' | 'view' | 'edit';
}
```

Two application areas deliberately have no permission of their own:

- **Dashboard.** There is no `dashboard` permission. Each summary card renders only when the user
  can view the module it summarizes — the inventory card requires `inventory` view, the repair
  card requires `maintenance` view, and so on. A user with no viewable module sees an empty-state
  dashboard rather than a broken one.
- **Action List.** There is no `action_list` permission. The Action List follows the
  `productions` permission, because an action item exists only as the resolution of a production
  requirement. `productions: view` can read the Action List; `productions: edit` can create and
  update action items.

## 5. Team Scope

Members may belong to one or more teams.

Permission and team are two different axes. Permission answers *which module, and may I write?*
Team answers *which records inside that module?*

Not every collection is team-scoped. Applying team scope to organization-level records would make
them uneditable by anyone but the Admin, because they carry no owning team at all.

**Team-scoped collections** — editing requires the record's team to be one of the user's teams:

- `inventory_items`
- `maintenance_records`
- `production_requirements`
- `action_items`

**Organization-level collections** — the module permission alone decides, with no team check:

- `productions`
- `calendar_events`
- `teams`

MVP rules:

- `view` permission allows reading all of that module's data inside the active organization,
  team-scoped or not.
- `edit` permission on a team-scoped collection allows editing records whose team is one of the
  user's assigned teams.
- `edit` permission on an organization-level collection allows editing any record of that module
  inside the organization.
- A team-scoped record with no team assigned is editable by Admin only.
- Admin can view and edit everything in the active organization, across all teams.

This keeps the permission model understandable while preventing one technical team from casually editing another team's records.

If the project owner later wants full organization-wide edit permission for some non-admin members, introduce it explicitly rather than silently weakening team scope.

## 6. Suggested Default Member Permissions

When an Admin converts an Unassigned user to Member, do not automatically give broad permissions.

Suggested starting defaults:

- inventory: view
- maintenance: none
- productions: view
- calendar: view

Admin then adjusts permissions intentionally.

These are UX defaults, not security assumptions. Note that these defaults already satisfy the
promotion condition, so saving them together with at least one team is what turns an Unassigned
user into a Member.

## 7. Example Memberships

### Example A — Lighting Technician

Teams:

- Lighting

Permissions:

- Inventory: Edit
- Maintenance: Edit
- Productions: Edit
- Calendar: View

Result:

The user may edit Lighting-owned inventory and repair records, and — because Action List follows
the `productions` permission — may work the action items for Lighting-owned requirements. They
may not edit Costume-owned records. Dashboard shows the inventory, repair, production, and
calendar cards, since all four modules are viewable.

### Example B — Stage Manager

Teams:

- Stage Management

Permissions:

- Inventory: View
- Maintenance: View
- Productions: Edit
- Calendar: Edit

Result:

Productions and calendar events are organization-level, so this user may create and edit any
production and any event in the organization without a team check. Production requirements and
action items remain team-scoped, so editing those is limited to Stage Management records.

### Example C — Newly Joined User

Role:

- Unassigned

Teams:

- none

Permissions:

- all none

## 8. Admin Transfer Rules

For MVP, assume one active Admin per organization unless the project owner explicitly changes this model.

Transfer requirements:

1. Initiator must be current Admin.
2. Target must already be an active member of the same organization.
3. Target cannot be Unassigned after transfer.
4. Operation must be atomic.
5. Target keeps their own `team_ids` and `permissions` unchanged. Admin access takes precedence
   over those values while they hold administration.
6. Previous Admin's role resolves by applying the assignment condition in section 2b to the
   `team_ids` and `permissions` their membership already carries — Member if satisfied, Unassigned
   if not.
7. There must never be a moment when the organization has zero Admins.

Implementation is a **client-side Firestore transaction**, not a Cloud Function. The transaction
reads `organizations/{orgId}` and the target membership, confirms the caller is the current Admin
and the target membership is active, then writes `admin_uid` and `updated_at`. No membership
document is touched.

Security Rules enforce the same conditions independently: only the current `admin_uid` may change
`admin_uid`, only those two fields may change, and the incoming uid must have an existing active
membership in that organization.

This works because permission data is never destroyed when a user becomes Admin. The outgoing
Admin's teams and permissions are whatever they were before — or empty, if they created the
organization and were never assigned any. An outgoing Admin who lands in Unassigned is not a
failure state: it correctly says the user holds no operational assignment, and the new Admin
assigns them through the normal Member Detail flow.

The Transfer Admin screen therefore needs no additional UI for configuring the outgoing Admin's
teams or permissions.

## 9. Join-Code Security

A join code proves only that a user may request membership.

It does not grant operational access.

Joining always creates a membership with `team_ids: []`, all permissions `none`, and
`is_active: true`. Its effective role is therefore Unassigned. Security Rules **pin these values on
create**, so a joining user cannot grant themselves access on the way in. This is the single most
important rule in the join path.

Without a Cloud Function, the joining client reads the code document itself, so the code is treated
as a bearer secret: 16 characters from a 32-character alphabet, generated with
`crypto.getRandomValues()`. `get` is allowed to any signed-in user; `list` is denied to everyone,
so codes and organizations cannot be enumerated.

A membership is created together with a join proof in one batch, and Rules verify inside that batch
that the proof names a real, active code belonging to the same organization. The membership itself
never stores the code, so reading a colleague's membership reveals nothing about it.

An existing membership — active or deactivated — makes the create fail, because the document ID is
deterministic. A deactivated member cannot re-join with a code; only the Admin can reactivate
them.

## 10. Firestore / Backend Enforcement

UI permission checks are for usability, not security.

Security Rules are the only enforcement point. There is no server-side check behind them.

MVP security rests on six things, and on nothing else:

1. Firebase Authentication
2. Firestore Security Rules
3. A secure 80-bit join code, generated with `crypto.getRandomValues()`
4. `get` / `list` separation, so nothing can be enumerated
5. Strict schema validation on every write
6. Rules tests run against the Firestore emulator

App Check is optional post-MVP hardening. It is not an authorization mechanism and does not provide
rate limiting; it must never be described as standing in for either.

Rules must verify at minimum:

- `request.auth.uid` exists,
- membership exists for the target `organization_id`,
- membership `is_active` is true,
- role is Admin or permission level allows the action,
- team ownership rules are satisfied when editing team-scoped records,
- user cannot write a different `organization_id` into a record to escape authorization.

The membership document ID is `${organizationId}_${uid}`, so every one of these checks resolves
through a single deterministic `get()` — no query and no index in the rules path.

Collection-specific requirements:

- `organization_join_codes` — `get` allowed to any signed-in user, since the joining client must
  read it; `list` denied to everyone so codes and organizations cannot be enumerated; writes
  restricted to the Admin of the referenced organization.
- `organization_admin_settings` — `get` and `update` restricted to the Admin; `list` and `delete`
  denied. This is what keeps an ordinary member from learning their organization's current code.
- `organization_membership_join_proofs` — `get` for the subject or the Admin; `list`, `update`, and
  `delete` denied; `create` only inside a valid join batch.
- `organization_memberships` — a user may read their own memberships and, with the required
  filters, the active member directory of an organization they belong to. Only the Admin may write
  another member's membership. `organization_id` and `uid` are immutable, and the membership whose uid
  equals `admin_uid` cannot be deactivated.
- `organizations` — only the current `admin_uid` may change `admin_uid`, and only to a uid holding
  an active membership in that organization.
- `maintenance_records` — team scope is evaluated against the record's own denormalized
  `team_id`, not by reading the linked inventory item.
- `calendar_events` — rules enforce organization scope and the `calendar` permission level only.
  `team_ids` is a display filter and is not evaluated as a security boundary.
- `action_items` — the document ID must equal the `requirement_id`, and the referenced
  requirement must belong to the same organization.

## 10b. Security Rules Plan

| Collection | get | list | create | update | delete |
|---|---|---|---|---|---|
| `users` | signed in | denied | self | self, display name only | denied |
| `organizations` | active member | denied | creator, `admin_uid == self`, path A batch | Admin — either `admin_uid` transfer, or `name` with a matching snapshot | denied |
| `organization_memberships` | self, or active member of same org | self's own, or same-org active directory | path A batch, or valid join batch | Admin only | denied |
| `organization_join_codes` | any signed-in user | denied | path A batch, or Admin of an existing org | Admin, revocation only | denied |
| `organization_admin_settings` | Admin | denied | path A batch only | Admin | denied |
| `organization_membership_join_proofs` | self or Admin | denied | valid join batch | denied | denied |

### Two creation paths

At the moment an organization is created it has no Admin yet, so a rule that reads
`organizations/{organizationId}.admin_uid` cannot authorize the first join code or the first admin
settings document. The rules keep the two situations separate:

**Path A - initial organization creation.** Authorized by what the batch *will* produce:
`getAfter(/organizations/$(organizationId))` must exist with `admin_uid == request.auth.uid` and
`created_by_uid == request.auth.uid`. The caller earns the right to create the organization's first
membership, admin settings, and join code by becoming its Admin in the same atomic write. Path A is
the only way `organization_admin_settings` is ever created.

**Path B - existing organization.** Authorized by what already exists:
`get(/organizations/$(organizationId)).data.admin_uid == request.auth.uid`. This covers regenerating
a join code, updating admin settings, assigning memberships, and transferring administration.

### Organization rename

`organizations.name` and the active join code's `organization_name_snapshot` must change together,
because a user validating a code is not yet a member and cannot read the organization document. The
rename batch writes both, and the rule on the organization update requires that after the commit
the active code's `organization_name_snapshot` equals the new `name`, read with `getAfter()`. The
code ID comes from `organization_admin_settings` and is shape-checked before it is used as a path
segment.

Revoked codes are not rewritten. They cannot be used to join, so a stale name on them is inert.

### Rules are not filters

A `list` rule is evaluated against candidate documents, and Firestore rejects the **entire query**
if any candidate would fail. Firestore does not filter the result down to what the caller may read;
it returns `permission-denied` for the whole request. Every query therefore has to be written to
match its rule exactly.

**Organization Selection**

```js
query(collection(db, 'organization_memberships'),
  where('uid', '==', auth.currentUser.uid),
  where('is_active', '==', true))
```

Rule clause that admits it: `resource.data.uid == request.auth.uid`. Evaluated per document with no
document access call, since the check reads only the candidate itself. The `is_active` filter is
not required by the rule, but the application uses it so that deactivated memberships do not appear
in the picker.

**Member directory, non-Admin**

```js
query(collection(db, 'organization_memberships'),
  where('organization_id', '==', activeOrganizationId),
  where('is_active', '==', true))
```

Rule clause that admits it:
`resource.data.is_active == true && isActiveMemberOf(resource.data.organization_id)`. Both filters
are **mandatory**. Dropping `is_active` makes deactivated documents candidates, which fail the
clause and reject the whole query. Dropping `organization_id` makes other organizations' documents
candidates, which fail as well.

**Member directory, Admin**

```js
query(collection(db, 'organization_memberships'),
  where('organization_id', '==', activeOrganizationId))
```

Rule clause that admits it: `isAdminOf(resource.data.organization_id)`. An Admin may omit
`is_active` and see deactivated members, which the Unassigned and deactivated sections of Team &
Member Management need. A non-Admin issuing this same query is denied outright.

No other collection is ever queried. `organizations`, `organization_join_codes`,
`organization_admin_settings`, and `organization_membership_join_proofs` are read only by document
ID, and their `list` rules deny everyone.

### Validating atomic writes

Rules evaluate each write in a batch independently. A batch is validated as a unit with
`getAfter()` and `existsAfter()`, which see the state the commit will produce:

- Create Organization — the organization, the creator membership, the admin settings, and the join
  code each check that the others exist and agree after the commit.
- Join — the membership checks that its join proof exists after the commit, and that the proof
  names a code that is active and belongs to the same organization.

Any value used as a path segment must first be shape-checked. A `join_code_id` is validated with
`matches('^[A-HJ-NP-Z2-9]{16}$')` before it is interpolated into a `get()` path.

### Running the suite

```
npm run test:rules
```

`firebase-tools` is a project-local devDependency; nothing is installed globally. The Firestore
emulator it starts is a Java program, so **JDK 21 or newer is required** — `firebase-tools` refuses
to start on anything older.

The script asks macOS's `/usr/libexec/java_home -v 21+` for the newest installed JDK at or above
21, and falls back to whatever `JAVA_HOME` already holds when that lookup is unavailable — on Linux,
in CI, or on a machine with no JDK 21+ installed.

The lookup comes first deliberately. A developer machine often has `JAVA_HOME` pointing at an older
JDK for unrelated work, and honouring it would break this suite for a reason that has nothing to do
with the rules. No absolute path is hardcoded, and nothing is installed globally. If no suitable
runtime is found, `firebase-tools` reports the version problem directly.

### Rules test plan

Tested with `@firebase/rules-unit-testing` against the Firestore emulator, in **Phase 2A, before
any Phase 2B interface work begins**.

**Create Organization**

1. Full four-document batch succeeds
2. Malicious partial batch — organization alone, membership alone, join code alone, admin settings
   alone — each denied
3. Batch naming a different user as `admin_uid` denied
4. Forged creator membership: batch granting the creator teams or permissions above `none` denied
5. Admin settings pointing at a join code for a different organization denied
6. Join code whose `organization_id` does not match the organization being created denied

**Join Organization**

7. Join with an active code and a matching proof in the same batch succeeds
8. Invalid join code — no such document — denied
9. Revoked join code, `active: false`, denied
10. Mismatched `organization_id` between proof, code, and membership denied
11. Forged join proof: membership created without a proof in the same batch denied
12. Self-granting join: membership create with a team or any permission above `none` denied
13. Membership create where `uid` is not the caller denied
14. Duplicate membership: creating a second membership for the same user and organization denied
15. Inactive membership rejoin: re-joining with a valid code after deactivation denied

**Membership administration**

16. Non-Admin updating any membership denied, including their own
17. Admin assigning `team_ids` and `permissions` succeeds
18. `organization_id` and `uid` changes denied
19. Deactivating the current Admin's membership denied

**Administration transfer**

20. Admin transfer by the current Admin succeeds
21. Admin transfer by a non-Admin denied
22. Admin transfer to a uid with no membership denied
23. Admin transfer to an inactive member denied
24. Update changing `admin_uid` together with any unrelated field denied

**Join codes**

25. Regenerate by the Admin succeeds: new code active, old code `active: false` with `revoked_at`
26. Old code rejected for joining after regeneration
27. Regenerate by a non-Admin denied
28. Direct `list` on `organization_join_codes` denied for every role
29. `get` on `organization_admin_settings` by a Member denied

**Organization rename**

30. Rename updating `organizations.name` and the active code's snapshot together succeeds
31. Rename updating only `organizations.name` denied

**Enumeration and isolation**

32. `list` on `organizations` denied for every role
33. `list` on `organization_admin_settings` and `organization_membership_join_proofs` denied
34. Cross-organization access: a member of organization A denied get, list, and write everywhere in
    organization B
35. Unauthenticated caller denied on every collection
36. Member directory query without `is_active` denied for a non-Admin, and denied rather than
    filtered

### Directory query scale test

The member directory rule calls `get()` per candidate document. Firebase documents that some
document access calls are cached and that cached calls do not count against the access-call limit,
but it does not promise caching across an entire query evaluation in every situation. This project
therefore does **not** treat that behaviour as a guaranteed architecture invariant.

The suite runs the directory query in the emulator against organizations holding **1, 5, 10, and 20
members**, as both Admin and non-Admin.

**Measured result.** All four sizes pass in the Firebase Emulator, for both roles, including the
Admin variant that omits the `is_active` filter. The current implementation does not reproduce an
access-call limit problem at any tested size.

What that result does and does not establish:

- It is sufficient evidence to proceed to Phase 2B.
- It is **not** a guarantee. Caching remains an implementation behaviour, not a contract this design
  is entitled to rely on, and the emulator is not production Firestore.
- If `permission-denied` or a size-related failure appears against real Firestore, revisit the
  member directory authorization structure — for example by restricting the directory to Admins and
  denormalizing the display names that assignee pickers need.

Whatever the outcome, do not relax the rule, widen a `list` permission, or drop a required query
filter to make something pass. If a size fails, **stop and report before building any interface on
top of it.**

## 11. Route Guards

Recommended route layers:

### AuthGuard

Requires authenticated Firebase user.

### OrganizationGuard

Requires membership in active organization.

### AssignmentGuard

Blocks Unassigned users from operational modules.

### PermissionGuard

Requires module-level view/edit permission for one of the four modules.

Admin passes all normal PermissionGuards for the active organization.

The Dashboard route has no PermissionGuard, because Dashboard has no permission. It sits behind
AssignmentGuard and renders each summary card only if the underlying module is viewable. Action
List routes are guarded by the `productions` permission.

## 12. AI Permission Rules

AI features cannot bypass permissions.

### AI Smart Search

- only searches records the user is allowed to read,
- AI never receives organization data the user should not access.

### AI Requirement Generator

- requires production view access to open,
- requires production edit access to save approved suggestions,
- AI output itself grants no write permission.

Neither feature may return a Firestore document ID produced by the model. Team names and
inventory match keywords are resolved to real IDs by application code against data the user is
already permitted to read, so AI cannot become a path to a record outside the active organization.
