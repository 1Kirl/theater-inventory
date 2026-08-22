# Theater Inventory Tracker — Roles and Permissions

## 1. Permission Model

Authorization is evaluated within the active organization.

A user may have different roles and permissions in different organizations.

Do not store a global Admin flag on the user profile.

Permissions are stored inside the membership document — `organization_memberships` carries
`team_ids[]` and a `permissions` map. There is no separate `team_permissions` collection and no
per-team permission document. This keeps every authorization decision reachable from a single
membership read, in the client and in Security Rules alike.

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

While `role === 'admin'`, access does not consult `team_ids` or `permissions` at all. Those fields
are **kept, not cleared**, when a user becomes Admin — they are what determines the user's role
again if administration is later transferred away (section 8).

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

Promotion to Member is automatic and is driven by the assignment itself.

A membership satisfies the **assignment condition** when both hold:

- `team_ids` contains at least one team, **and**
- at least one of the four module permissions is `view` or `edit`.

When an Admin saves a membership satisfying that condition, `role` becomes `member`. There is no
separate status control to forget. When a saved membership stops satisfying it — every team
removed, or every module back to `none` — `role` returns to `unassigned`.

The same condition decides the outgoing Admin's role after a transfer (section 8). It is one rule
evaluated in two places, not two rules.

### Deactivated

`is_active = false` on the membership. Treated as no access at all — the same as having no
membership — while preserving the user's historical references. The MVP has no hard delete for
memberships, and the current Admin's membership cannot be deactivated.

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
5. Target becomes Admin and keeps their own `team_ids` and `permissions` unchanged. Admin access
   takes precedence over those values while the role is held.
6. Previous Admin's role is resolved by applying the assignment condition from section 2 to the
   `team_ids` and `permissions` their membership already carries:
   - satisfies the condition → `role = 'member'`
   - does not satisfy it → `role = 'unassigned'`
7. There must never be a moment when the organization has zero Admins.

Use the `transferAdmin` callable Cloud Function for the transfer.

This works because permission data is never destroyed when a user becomes Admin. The outgoing
Admin's teams and permissions are whatever they were before — or empty, if they created the
organization and were never assigned any. An outgoing Admin who lands in `unassigned` is not a
failure state: it correctly says the user holds no operational assignment, and the new Admin
assigns them through the normal Member Detail flow.

The Transfer Admin screen therefore needs no additional UI for configuring the outgoing Admin's
teams or permissions.

## 9. Join-Code Security

A join code proves only that a user may request membership.

It does not grant operational access.

Joining must always create:

- role: `unassigned`
- team_ids: `[]`
- permissions: all `none`

Use a trusted Cloud Function to validate the code and create the membership.

## 10. Firestore / Backend Enforcement

UI permission checks are for usability, not security.

Firestore Security Rules and Cloud Functions must verify at minimum:

- `request.auth.uid` exists,
- membership exists for the target `organization_id`,
- membership `is_active` is true,
- role is Admin or permission level allows the action,
- team ownership rules are satisfied when editing team-scoped records,
- user cannot write a different `organization_id` into a record to escape authorization.

The membership document ID is `${organizationId}_${uid}`, so every one of these checks resolves
through a single deterministic `get()` — no query and no index in the rules path.

Collection-specific requirements:

- `organization_join_codes` — `get` denied to all clients so codes cannot be probed; `list`
  allowed only to an Admin querying their own `organization_id`; writes are Cloud Function only.
- `organization_memberships` — a user may read their own memberships; only an Admin of that
  organization may write another member's membership; role changes to or from `admin` are Cloud
  Function only.
- `maintenance_records` — team scope is evaluated against the record's own denormalized
  `team_id`, not by reading the linked inventory item.
- `calendar_events` — rules enforce organization scope and the `calendar` permission level only.
  `team_ids` is a display filter and is not evaluated as a security boundary.
- `action_items` — the document ID must equal the `requirement_id`, and the referenced
  requirement must belong to the same organization.

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
