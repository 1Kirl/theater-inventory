# Theater Inventory Tracker — Data Model

## 1. Principles

1. Firestore is the primary persistent database.
2. Every organization-owned document must contain `organization_id` or live in an organization-scoped path with equivalent authorization guarantees.
3. User identity and organization membership are separate concepts.
4. Do not duplicate large data unnecessarily.
5. Denormalize only small display fields when it materially simplifies list rendering.
6. All timestamps should use Firestore Timestamp/server timestamps where appropriate.
7. All client models should have TypeScript interfaces.

## 2. Collection Overview

Recommended top-level collections:

- `users`
- `organizations`
- `organization_memberships`
- `organization_join_codes`
- `teams`
- `inventory_items`
- `maintenance_records`
- `productions`
- `production_requirements`
- `action_items`
- `calendar_events`

Optional later:

- `audit_logs`
- `ai_usage_logs`

## 3. users

Path:

`users/{uid}`

Purpose: Personal user profile independent from organizations.

Fields:

```ts
interface UserProfile {
  uid: string;
  user_id: string;           // public login identifier, immutable in MVP
  display_name: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Notes:

- Do not store plain-text passwords.
- Authentication credentials live in Firebase Authentication.
- `user_id` should be normalized for uniqueness.
- Internal synthetic Firebase Auth email is implementation detail and should not be presented as user profile data.

## 4. organizations

Path:

`organizations/{organizationId}`

```ts
interface Organization {
  organization_id: string;
  name: string;
  description?: string;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  active_join_code_id: string;
}
```

Notes:

- `active_join_code_id` references the currently valid join-code document.
- Normal members should not need access to privileged code-management data beyond what the permission design allows.

## 5. organization_memberships

Recommended document ID:

`${organizationId}_${uid}`

Path:

`organization_memberships/{organizationId}_{uid}`

```ts
type MembershipRole = 'admin' | 'member' | 'unassigned';
type PermissionLevel = 'none' | 'view' | 'edit';

interface ModulePermissions {
  dashboard: PermissionLevel;
  inventory: PermissionLevel;
  maintenance: PermissionLevel;
  productions: PermissionLevel;
  action_list: PermissionLevel;
  calendar: PermissionLevel;
}

interface OrganizationMembership {
  organization_id: string;
  uid: string;
  role: MembershipRole;
  team_ids: string[];
  permissions: ModulePermissions;
  joined_at: Timestamp;
  assigned_at?: Timestamp;
  assigned_by_uid?: string;
  is_active: boolean;
}
```

Rules:

- Admin receives effective full access regardless of the permission map.
- New join-by-code memberships use:
  - role = `unassigned`
  - team_ids = `[]`
  - all permissions = `none`
- When Admin assigns the user, role becomes `member` and team/permission fields are updated.

## 6. organization_join_codes

Path:

`organization_join_codes/{code}`

Document ID is the actual normalized join code.

```ts
interface OrganizationJoinCode {
  code: string;
  organization_id: string;
  organization_name: string;
  is_active: boolean;
  created_at: Timestamp;
  created_by_uid: string;
}
```

Recommended format:

- 8 characters
- uppercase letters and digits
- avoid visually confusing characters when possible

Example:

`HTR7K29Q`

Security recommendation:

Use callable Cloud Functions for:

- creating organization + first Admin + join code,
- joining by code,
- regenerating code,
- transferring Admin.

This avoids trusting the client with privileged membership transitions.

## 7. teams

Path:

`teams/{teamId}`

```ts
interface TheaterTeam {
  team_id: string;
  organization_id: string;
  name: string;
  description?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Example names:

- Lighting
- Sound
- Scenic / Set
- Props
- Costume
- Stage Management

## 8. inventory_items

Path:

`inventory_items/{itemId}`

```ts
interface ConditionCounts {
  excellent: number;
  good: number;
  fair: number;
  needs_repair: number;
  unusable: number;
}

interface InventoryItem {
  item_id: string;
  organization_id: string;
  name: string;
  category: string;
  team_id?: string;
  quantity_total: number;
  quantity_available: number;
  condition_counts: ConditionCounts;
  location: string;
  last_inspected_at?: Timestamp;
  notes?: string;
  photo_url?: string; // stretch only
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Validation:

- all quantities are non-negative integers,
- `quantity_available <= quantity_total`,
- sum of condition counts must not exceed `quantity_total`.

The application may derive a primary condition summary for display; it does not need a separate stored field unless useful.

## 9. maintenance_records

Path:

`maintenance_records/{maintenanceId}`

```ts
type MaintenanceStatus =
  | 'planned'
  | 'sent'
  | 'in_service'
  | 'ready'
  | 'returned'
  | 'cancelled';

type ReturnMethod = 'pickup' | 'delivery' | 'other';

interface MaintenanceRecord {
  maintenance_id: string;
  organization_id: string;
  item_id: string;
  quantity_sent: number;
  issue_description: string;
  status: MaintenanceStatus;
  sent_at?: Timestamp;
  return_method?: ReturnMethod;
  expected_return_at?: Timestamp;
  returned_at?: Timestamp;
  service_provider_name?: string;
  service_provider_phone?: string;
  service_provider_email?: string;
  cost?: number;
  repair_notes?: string;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Derived UI state:

A record is overdue when:

- `expected_return_at < now`, and
- status is not `returned` or `cancelled`.

## 10. productions

Path:

`productions/{productionId}`

```ts
type ProductionStatus = 'planning' | 'active' | 'completed';

interface Production {
  production_id: string;
  organization_id: string;
  title: string;
  description?: string;
  notes?: string;
  start_date?: Timestamp;
  end_date?: Timestamp;
  status: ProductionStatus;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Production list summary values such as requirement count and unresolved action count may be queried/derived rather than stored initially.

## 11. production_requirements

Path:

`production_requirements/{requirementId}`

```ts
type RequirementActionType =
  | 'buy'
  | 'rent'
  | 'build'
  | 'repair'
  | 'already_available';

interface ProductionRequirement {
  requirement_id: string;
  organization_id: string;
  production_id: string;
  item_name: string;
  inventory_item_id?: string;
  required_qty: number;
  team_id?: string;
  action_type?: RequirementActionType;
  notes?: string;
  source: 'manual' | 'ai_approved';
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Important:

Do not treat `available_qty` or `shortage_qty` as AI-owned values.

Preferred implementation:

- retrieve real available quantity from linked inventory item,
- compute shortage in application logic.

```ts
const shortageQty = Math.max(requiredQty - availableQty, 0);
```

If a free-text requirement has no inventory link, available quantity may be treated as 0 until a match is selected, or shown as Not Matched. Prefer showing Not Matched rather than pretending the inventory has zero if that distinction improves clarity.

## 12. action_items

Path:

`action_items/{actionItemId}`

```ts
type ActionType = 'buy' | 'rent' | 'build' | 'repair';
type ActionStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

interface ActionItem {
  action_item_id: string;
  organization_id: string;
  production_id: string;
  requirement_id: string;
  item_name: string;
  action_type: ActionType;
  quantity: number;
  team_id?: string;
  assignee_uid?: string;
  due_date?: Timestamp;
  status: ActionStatus;
  notes?: string;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

One requirement should not accidentally create duplicate active action items for the same intended work. Prefer an update-or-create strategy tied to `requirement_id`.

## 13. calendar_events

Path:

`calendar_events/{eventId}`

```ts
type CalendarVisibility = 'all_teams' | 'team';

interface CalendarEvent {
  event_id: string;
  organization_id: string;
  title: string;
  event_type: string;
  start_at: Timestamp;
  end_at?: Timestamp;
  visibility: CalendarVisibility;
  team_id?: string;
  production_id?: string;
  maintenance_id?: string;
  notes?: string;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Validation:

- if visibility is `team`, `team_id` is required,
- linked production/maintenance records must belong to the same organization.

## 14. AI Smart Search Data Contract

AI Smart Search output is transient and does not need a Firestore collection.

Example TypeScript structure:

```ts
interface InventorySearchFilters {
  search_text?: string;
  category?: string;
  team_id?: string;
  location?: string;
  conditions?: Array<
    'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable'
  >;
  availability?: 'available' | 'unavailable' | 'any';
}
```

The AI returns this structure. The application validates it and performs the Firestore query.

## 15. AI Requirement Generator Data Contract

AI suggestions are transient until approved.

```ts
interface AIRequirementSuggestion {
  client_temp_id: string;
  item_name: string;
  suggested_qty: number;
  category?: string;
  suggested_team_name?: string;
  suggested_inventory_item_id?: string;
  rationale?: string;
}
```

After user approval, convert selected suggestions into normal `ProductionRequirement` documents with:

`source = 'ai_approved'`.

## 16. Recommended Indexes

Exact composite indexes should be added only as required by actual Firestore queries.

Likely query patterns include:

- inventory by organization + category,
- inventory by organization + team,
- maintenance by organization + status,
- productions by organization + status,
- action items by organization + status,
- calendar events by organization + date range,
- memberships by organization + role,
- memberships by uid.

Do not create speculative indexes before Firestore requests them or before query design is confirmed.

## 17. Deletion Strategy

For MVP, prefer safe deletion rules:

- completed productions may be archived rather than deleted,
- maintenance history should not be deleted casually,
- an organization should not be deletable until an explicit future deletion flow is designed,
- removing a member should not delete their historical `created_by_uid` references.
