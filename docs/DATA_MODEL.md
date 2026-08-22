# Theater Inventory Tracker — Data Model

## 1. Principles

1. Firestore is the primary persistent database.
2. Every organization-owned document must contain `organization_id` or live in an organization-scoped path with equivalent authorization guarantees.
3. User identity and organization membership are separate concepts.
4. Do not duplicate large data unnecessarily.
5. Denormalize only small display fields when it materially simplifies list rendering.
6. All timestamps should use Firestore Timestamp/server timestamps where appropriate.
7. All client models should have TypeScript interfaces.
8. Derivable values are not stored. Shortage quantity, condition summary, overdue state,
   requirement counts, and dashboard totals are computed by application logic from stored
   data. The only sanctioned exceptions are the explicit denormalizations listed in this
   document.

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

Deliberately not used:

- `team_permissions` — permissions are stored inside `organization_memberships`
  (`team_ids[]` + `permissions`). There is no separate per-team permission collection.

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
}
```

Notes:

- The organization document does **not** store the join code. Firestore cannot restrict reads
  at field level, and every member — including `unassigned` members — must read this document
  to display the organization name. Storing the code here would expose it to all members.
- The active join code lives only in `organization_join_codes` (see section 6).
- The current Admin is derived from `organization_memberships` where `role === 'admin'`.
  Do not denormalize an `admin_uid` field onto the organization document; a second source of
  truth for administration can drift from the membership record.

## 5. organization_memberships

Recommended document ID:

`${organizationId}_${uid}`

Path:

`organization_memberships/{organizationId}_{uid}`

```ts
type MembershipRole = 'admin' | 'member' | 'unassigned';
type PermissionLevel = 'none' | 'view' | 'edit';

interface ModulePermissions {
  inventory: PermissionLevel;
  maintenance: PermissionLevel;
  productions: PermissionLevel;
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

Module notes:

- The MVP has exactly four permission modules: `inventory`, `maintenance`, `productions`,
  `calendar`.
- **Dashboard has no permission of its own.** Each dashboard summary card renders only when the
  user can view the module it summarizes.
- **Action List has no permission of its own.** It follows the `productions` permission.

Rules:

- Admin receives effective full access regardless of the permission map.
- New join-by-code memberships use:
  - role = `unassigned`
  - team_ids = `[]`
  - all permissions = `none`
- A membership satisfies the **assignment condition** when `team_ids` holds at least one team
  **and** at least one of the four module permissions is `view` or `edit`.
- Role transition is automatic. Saving a membership that satisfies the assignment condition sets
  `role = 'member'` along with `assigned_at` / `assigned_by_uid`. There is no manual role dropdown
  for this transition; `member` is never set independently of a valid assignment.
- Saving a membership that no longer satisfies it — every team removed, or every module back to
  `none` — returns `role` to `'unassigned'`.
- `team_ids` and `permissions` are **retained, not cleared, when a user becomes Admin.** While
  `role === 'admin'` those fields are not consulted, but they are what the assignment condition
  reads to resolve the outgoing Admin's role after a Transfer Admin.
- `is_active: false` deactivates a membership without deleting it. A deactivated membership is
  treated as no access at all. See section 17.

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

Why the code is the document ID:

Firestore cannot enforce uniqueness on a field. Using the normalized code as the document ID is
what structurally guarantees that two organizations can never hold the same active code.

Required Cloud Functions:

The following operations run in callable Cloud Functions, never in the client:

- `createOrganization` — organization + first Admin membership + join code, atomically,
- `joinOrganizationByCode` — validate code, prevent duplicate membership, create the
  `unassigned` membership,
- `regenerateOrganizationCode` — deactivate the current code and issue a new one,
- `transferAdmin` — atomic demote/promote.

Client access rules for this collection:

- Members and Unassigned members cannot read a join code at all.
- `get` by document ID is **denied** to every client. Allowing it would let anyone probe whether
  an arbitrary code exists and discover organizations. Code validation happens only inside
  `joinOrganizationByCode`.
- `list` is allowed only for an Admin, and only when the query constrains `organization_id` to an
  organization where the caller is Admin. This is how Organization Settings shows the current code
  without exposing any other organization's code.
- Only an Admin of the organization may call `regenerateOrganizationCode`.
- Clients never write to this collection.

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

`quantity_available` is a **manually maintained authoritative value**. No other feature writes to
it. In particular, creating or returning a maintenance record does not change it automatically;
the technician is prompted to review it (see section 9).

The condition summary is **derived, never stored**. It is the worst state holding at least one
unit, in the order `unusable` > `needs_repair` > `fair` > `good` > `excellent`. When the condition
counts sum to less than `quantity_total`, the remaining units are displayed as **Unclassified**
rather than assigned to any bucket.

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
  team_id?: string;          // copied from the linked inventory item at creation
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

`team_id` is a deliberate denormalization. It is copied from the linked inventory item when the
record is created so that Security Rules can evaluate team scope with a single document read
instead of joining back to `inventory_items` on every write. If the item's owning team changes
later, existing maintenance records keep the team they were filed under.

Derived UI state:

A record is overdue when:

- `expected_return_at < now`, and
- status is not `returned` or `cancelled`.

Quantity currently in service is derived, never stored. Sum `quantity_sent` across records whose
status is `sent`, `in_service`, or `ready`. This figure is displayed **alongside**
`quantity_available`, not subtracted from it.

When status becomes `returned`, prompt the user to review the item's condition counts and
`quantity_available`. The application does not adjust either value on its own.

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

A requirement with no `inventory_item_id` is **Not Matched**:

- `available_qty` is `null` — not `0`,
- shortage is not calculated and is displayed as `Not Matched`,
- no Action Item may be created from it.

Shortage becomes meaningful only once the requirement is linked to a real inventory item. Treating
an unlinked requirement as having zero availability would misreport a shortage the organization
may not actually have.

## 12. action_items

Path:

`action_items/{requirementId}`

The document ID **is** the `requirement_id`. Firestore has no unique constraint, so using the
requirement as the key is what structurally enforces at most one Action Item per requirement.

```ts
type ActionType = 'buy' | 'rent' | 'build' | 'repair';
type ActionStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';

interface ActionItem {
  action_item_id: string;    // equals requirement_id
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

Creation rules:

- An Action Item is created or updated only when the user chooses a shortage action type on a
  requirement. Nothing is generated automatically from a shortage on its own.
- No Action Item is created when the requirement is Not Matched, when shortage is `0`, or when
  the requirement's state is Already Available.
- Writing uses update-or-create against `action_items/{requirement_id}`.
- If a shortage later drops to zero, mark the existing Action Item `done` or `cancelled`. Never
  delete it — it is work history.
- `quantity` defaults to the shortage at the moment of creation and stays user-editable
  afterwards. It is never overwritten by a later shortage recalculation.

The two numbers carry different meanings and are displayed separately:

- **action item quantity** — how much work the user actually intends to do,
- **current shortage** — recomputed from live inventory each time it is shown.

They legitimately diverge. A crew may decide to build three platforms even though the current
shortage says four.

## 13. calendar_events

Path:

`calendar_events/{eventId}`

```ts
type CalendarVisibility = 'all_teams' | 'teams';

interface CalendarEvent {
  event_id: string;
  organization_id: string;
  title: string;
  event_type: string;
  event_date: Timestamp;     // date-only; times are separate and optional
  start_time?: string;       // 'HH:mm'
  end_time?: string;         // 'HH:mm'
  visibility: CalendarVisibility;
  team_ids: string[];        // empty when visibility is 'all_teams'
  production_id?: string;
  maintenance_id?: string;
  notes?: string;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

An event may be shown to several teams at once, so visibility carries `team_ids[]` rather than a
single team.

Date and time are separate fields. An event with no `start_time` is an **all-day event**, such as
a build day. A single start timestamp could not express that.

Recurring events and timezone handling beyond the organization's local time are not part of the
MVP. Treat `event_date` as a local calendar date.

Validation:

- if visibility is `teams`, `team_ids` must contain at least one team,
- if visibility is `all_teams`, `team_ids` is empty,
- `end_time` requires `start_time` and must not precede it,
- linked production/maintenance records must belong to the same organization.

Team visibility is a **display filter, not a security boundary**. Any member with `calendar`
view permission may read every event in the organization; `team_ids` drives filtering and
labelling in the UI. Security Rules enforce organization scope and the `calendar` permission
level, and do not evaluate `team_ids`.

## 14. AI Smart Search Data Contract

AI Smart Search output is transient and does not need a Firestore collection.

Example TypeScript structure:

```ts
interface InventorySearchFilters {
  search_text?: string;
  category?: string;
  team_name?: string;        // a name, never an ID
  location?: string;
  conditions?: Array<
    'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable'
  >;
  availability?: 'available' | 'unavailable' | 'any';
}
```

The AI returns this structure. The application validates it with Zod and performs the Firestore
query.

The model returns `team_name`, never `team_id`. It has no way to know real document IDs, so an ID
it produced would be fabricated. The application resolves the name against the active
organization's `teams` collection; an unresolvable name is dropped from the filter set and
reported in the interpreted-filter summary. `conditions` is always an array so that queries such
as "damaged or unusable" are expressible.

## 15. AI Requirement Generator Data Contract

AI suggestions are transient until approved.

```ts
interface AIRequirementSuggestion {
  client_temp_id: string;
  item_name: string;
  suggested_qty: number;
  category?: string;
  suggested_team_name?: string;    // a name, never an ID
  inventory_match_keyword?: string; // a search hint, never an ID
  rationale?: string;
}
```

The model never emits a Firestore document ID. It returns a team **name** and an inventory match
**keyword**; the application resolves both against real organization data and shows the proposed
match for the user to confirm or correct. A low-confidence match is never linked silently.

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
- memberships by uid,
- join codes by organization + is_active (Admin-only, for Organization Settings).

Do not create speculative indexes before Firestore requests them or before query design is confirmed.

## 17. Deletion Strategy

For MVP, prefer safe deletion rules:

- completed productions may be archived rather than deleted,
- maintenance history should not be deleted casually,
- an organization should not be deletable until an explicit future deletion flow is designed,
- removing a member should not delete their historical `created_by_uid` references.

Member removal is deactivation, not deletion. The MVP has no hard delete for memberships: set
`is_active = false`. This preserves every `created_by_uid`, `assignee_uid`, and
`assigned_by_uid` reference the organization's history depends on. A deactivated membership is
denied all access by Security Rules and is listed separately in Team & Member Management. The
Admin's own membership cannot be deactivated — administration must be transferred first, so that
the organization never reaches zero Admins.

Inventory items and teams have no delete flow in the MVP either. Deleting a team would orphan
`membership.team_ids`, `inventory_items.team_id`, and `maintenance_records.team_id`.
