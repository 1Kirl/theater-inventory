# Theater Inventory Tracker — Roles and Permissions

## 1. Permission Model

Authorization is evaluated within the active organization.

A user may have different roles and permissions in different organizations.

Do not store a global Admin flag on the user profile.

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

Recommended permission map:

```ts
interface ModulePermissions {
  dashboard: 'none' | 'view' | 'edit';
  inventory: 'none' | 'view' | 'edit';
  maintenance: 'none' | 'view' | 'edit';
  productions: 'none' | 'view' | 'edit';
  action_list: 'none' | 'view' | 'edit';
  calendar: 'none' | 'view' | 'edit';
}
```

Dashboard `edit` does not need special write capability; it may simply be treated as equivalent to view for MVP. Keep the same enum for consistency.

## 5. Team Scope

Members may belong to one or more teams.

Team membership is used to scope responsibility and, where appropriate, editing.

Recommended MVP rule:

- `view` permission allows the user to view permitted organization-level module data.
- `edit` permission allows editing records that belong to one of the user's assigned teams.
- records with no team assignment may be editable by Admin only unless a specific rule is added.
- Admin can view/edit all teams.

This keeps the permission model understandable while preventing one technical team from casually editing another team's records.

If the project owner later wants full organization-wide edit permission for some non-admin members, introduce it explicitly rather than silently weakening team scope.

## 6. Suggested Default Member Permissions

When an Admin converts an Unassigned user to Member, do not automatically give broad permissions.

Suggested starting defaults:

- dashboard: view
- inventory: view
- maintenance: none
- productions: view
- action_list: view
- calendar: view

Admin then adjusts permissions intentionally.

These are UX defaults, not security assumptions.

## 7. Example Memberships

### Example A — Lighting Technician

Teams:

- Lighting

Permissions:

- Dashboard: View
- Inventory: Edit
- Maintenance: Edit
- Productions: View
- Action List: Edit
- Calendar: View

Result:

The user may edit Lighting-owned inventory and repair/action data but may not edit Costume-owned records.

### Example B — Stage Manager

Teams:

- Stage Management

Permissions:

- Dashboard: View
- Inventory: View
- Maintenance: View
- Productions: Edit
- Action List: Edit
- Calendar: Edit

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
5. Target becomes Admin.
6. Previous Admin becomes Member.
7. Previous Admin should receive a valid member permission map after transfer.
8. There must never be a moment when the organization has zero Admins.

Use a trusted Cloud Function for the transfer.

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
- membership is active,
- role is Admin or permission level allows the action,
- team ownership rules are satisfied when editing team-scoped records,
- user cannot write a different `organization_id` into a record to escape authorization.

## 11. Route Guards

Recommended route layers:

### AuthGuard

Requires authenticated Firebase user.

### OrganizationGuard

Requires membership in active organization.

### AssignmentGuard

Blocks Unassigned users from operational modules.

### PermissionGuard

Requires module-level view/edit permission.

Admin passes all normal PermissionGuards for the active organization.

## 12. AI Permission Rules

AI features cannot bypass permissions.

### AI Smart Search

- only searches records the user is allowed to read,
- AI never receives organization data the user should not access.

### AI Requirement Generator

- requires production view access to open,
- requires production edit access to save approved suggestions,
- AI output itself grants no write permission.
