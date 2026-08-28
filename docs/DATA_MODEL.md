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
   requirement counts, dashboard totals, and effective role are computed by application logic
   from stored data. The only sanctioned exceptions are the explicit denormalizations listed in
   this document.
9. There is no trusted server. Every write comes from the client, so every multi-document
   operation is a transaction or a batched write, and every invariant that must hold is expressed
   in Security Rules. Rules evaluate each write in a batch independently, so a batch is validated
   as a unit with `getAfter()` and `existsAfter()`.

## 2. Collection Overview

Recommended top-level collections:

- `users`
- `organizations`
- `organization_memberships`
- `organization_join_codes`
- `organization_admin_settings`
- `organization_membership_join_proofs`
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
  admin_uid: string;          // the single current Admin
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

Notes:

- The organization document does **not** store the join code. Firestore cannot restrict reads
  at field level, and every member — including Unassigned members — must read this document
  to display the organization name. Storing the code here would expose it to all members.
- The active join code lives in `organization_join_codes`, and the pointer to the current one
  lives in `organization_admin_settings` (sections 6 and 6b).
- `admin_uid` **is** the record of who administers the organization. It is not a denormalization
  of a membership field, because membership documents carry no role at all. Keeping
  administration in one field on one document makes "exactly one Admin" a structural property
  rather than an invariant that two documents have to agree on.
- Transfer Admin writes `admin_uid` and `updated_at`, and nothing else.

## 5. organization_memberships

Recommended document ID:

`${organizationId}_${uid}`

Path:

`organization_memberships/{organizationId}_{uid}`

```ts
type PermissionLevel = 'none' | 'view' | 'edit';

interface ModulePermissions {
  inventory: PermissionLevel;
  maintenance: PermissionLevel;
  productions: PermissionLevel;
  calendar: PermissionLevel;
}

interface OrganizationMembership {
  organization_id: string;             // must equal the first segment of the document ID
  uid: string;                // must equal the second segment of the document ID
  team_ids: string[];
  permissions: ModulePermissions;
  is_active: boolean;
  joined_at: Timestamp;
  updated_at: Timestamp;
}
```

There is deliberately **no `role` field**. See section 5b.

Module notes:

- The MVP has exactly four permission modules: `inventory`, `maintenance`, `productions`,
  `calendar`.
- **Dashboard has no permission of its own.** Each dashboard summary card renders only when the
  user can view the module it summarizes.
- **Action List has no permission of its own.** It follows the `productions` permission.

Rules:

- New memberships — created either by joining with a code or by creating the organization — use
  `team_ids: []`, all permissions `none`, and `is_active: true`. Security Rules pin these values on
  create, so a joining user cannot grant themselves access on the way in.
- Only the Admin may change `team_ids`, `permissions`, or `is_active`. A member cannot edit their
  own membership.
- `organization_id` and `uid` are immutable and must match the document ID.
- `team_ids` and `permissions` are **retained, not cleared, when a user becomes Admin.** They are
  not consulted while the user is Admin, but they are the only input the effective-role computation
  has once administration is transferred away.
- `is_active: false` deactivates a membership without deleting it. A deactivated membership is
  treated as no access at all. See section 17.
- The deterministic document ID is what prevents a second membership for the same user in the same
  organization. It is also what stops a deactivated member from re-joining with a code: the create
  fails because the document already exists, and only the Admin can reactivate.

## 5b. Effective Role

`role` is **not stored**. It is computed wherever it is needed, from two documents the caller can
already read:

```ts
type EffectiveRole = 'admin' | 'member' | 'unassigned';

function effectiveRole(
  organization: Organization,
  membership: OrganizationMembership | null,
  uid: string,
): EffectiveRole {
  if (organization.admin_uid === uid) return 'admin';
  if (!membership || !membership.is_active) return 'unassigned';
  if (membership.team_ids.length === 0) return 'unassigned';

  const levels = Object.values(membership.permissions);
  const hasModuleAccess = levels.some((level) => level === 'view' || level === 'edit');

  return hasModuleAccess ? 'member' : 'unassigned';
}
```

Why it is derived rather than stored:

- A stored role is a summary of `admin_uid`, `is_active`, `team_ids`, and `permissions`. Any write
  that changes one of those without also rewriting the role leaves the two disagreeing, and Security
  Rules would have to re-derive the role anyway to detect it.
- Transfer Admin becomes a single-field write. Both users' roles change because the computation
  reads a different `admin_uid`, not because anything was written to their memberships.
- Security Rules evaluate the same expression, so the UI and the authorization boundary cannot drift
  apart.

Admin bypasses the permission map entirely. Every other decision about module and team access reads
the membership as before.

## 6. organization_join_codes

Path:

`organization_join_codes/{code}`

Document ID is the actual normalized join code.

```ts
interface OrganizationJoinCode {
  organization_id: string;
  organization_name_snapshot: string;  // shown in the join preview
  active: boolean;
  created_by_uid: string;
  created_at: Timestamp;
  revoked_at?: Timestamp;              // set when a newer code supersedes this one
}
```

The document ID **is** the canonical join code. It is not repeated as a field: a second copy could
disagree with the ID, and Rules would then have to decide which one is authoritative.

Format and generation:

- Alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — 32 characters, with `I`, `O`, `0`, and `1` removed
  so a code can be read aloud or copied from a whiteboard without ambiguity.
- Length 16, giving 32^16 = 2^80 possible codes.
- Generated with `crypto.getRandomValues()`. `Math.random()` is never used for a code; it is not a
  cryptographic source and a predictable code is a way into an organization.

Example: `K7PFN4XQT3WMH9RC`

The UI may group the code for readability as `K7PF-N4XQ-T3WM-H9RC`. The document ID is always the
normalized form: trimmed, uppercased, with hyphens and whitespace removed. Input is normalized the
same way before lookup.

Why the code is the document ID:

Firestore cannot enforce uniqueness on a field. Using the normalized code as the document ID is
what structurally guarantees that two organizations can never hold the same active code. It also
makes validation a single `get` rather than a query, which matters because queries on this
collection are denied.

Why `organization_name_snapshot` exists:

A user checking a join code is not yet a member, so they cannot read
`organizations/{organizationId}` — that document is readable only by active members. The snapshot
is what lets the join preview show which organization the code belongs to before the user commits
to joining.

**Renaming an organization is therefore an atomic two-document write.** A rename must update
`organizations/{organizationId}.name` and the `organization_name_snapshot` of the **currently
active** join code in the same batch. Security Rules verify the pair with `getAfter()`: an update
to the organization name is rejected unless the active code's snapshot matches after the commit.

Revoked and inactive codes keep whatever snapshot they had. They cannot be used to join, so a
stale name on them is harmless, and rewriting historical documents on every rename would grow the
batch without bound.

Client access:

- `get` — any signed-in user. Without a server, the joining client has to read this document
  itself. The code is therefore a **bearer secret**: holding it is what proves a user may request
  membership. It grants no operational access, because the membership it creates has no teams and
  no permissions.
- `list` — denied to everyone. This is what prevents enumeration of codes and of organizations.
- `create` — two distinct paths, see below.
- `update` — the Admin of the referenced organization, and only to revoke: `active` to `false` with
  `revoked_at`.
- `delete` — denied. Revoked codes are kept so that a code is never silently reused.

**Two creation paths, because at initial creation there is no Admin yet.**

*Path A — initial organization creation.* The organization does not exist before the batch, so
there is nobody to be its Admin at the moment the rule runs. The rule instead requires that
`organizations/{organizationId}` is created **in the same batch** with
`admin_uid == request.auth.uid` and `created_by_uid == request.auth.uid`, checked with
`getAfter()`. The caller earns the right to create the first code by becoming the Admin in the same
atomic operation.

*Path B — existing organization.* The organization already exists, so the rule reads
`organizations/{organizationId}.admin_uid` and requires it to equal the caller. This is the
regenerate path.

Writing this as one rule with a `get()` would fail for path A, because the organization is not yet
readable. Writing it with only `getAfter()` would be loose for path B, since `getAfter()` on an
untouched document returns its current state and would still work — but keeping the paths separate
makes the intent explicit and keeps each condition minimal.

The same A/B split applies to `organization_admin_settings` creation.

A member cannot discover their own organization's current code from this collection, because
finding it would require a query. The pointer lives in `organization_admin_settings`.

Any code value used as a path segment in Security Rules must first be checked against
`matches('^[A-HJ-NP-Z2-9]{16}$')`, which is exactly this alphabet and length. Without that guard a
crafted value could change which document a Rules `get()` resolves to.

## 6b. organization_admin_settings

Path:

`organization_admin_settings/{organizationId}`

```ts
interface OrganizationAdminSettings {
  organization_id: string;
  current_join_code_id: string;   // the active code
  updated_at: Timestamp;
}
```

This collection exists for one reason: to hold data that the Admin may see and ordinary members may
not. Firestore cannot restrict reads at field level, so anything Admin-only needs its own document.

Client access:

- `get` and `update` — the Admin of that organization only. At update time the organization already
  exists, so the rule reads `admin_uid` directly.
- `create` — only in the initial-creation batch (path A above): the organization must be created in
  the same batch naming the caller as `admin_uid`, and `current_join_code_id` must point at a join
  code created in that same batch for the same organization.
- `list` and `delete` — denied to everyone.

## 6c. organization_membership_join_proofs

Path:

`organization_membership_join_proofs/{organizationId}_{uid}`

```ts
interface MembershipJoinProof {
  organization_id: string;
  uid: string;
  join_code_id: string;
  created_at: Timestamp;
}
```

Its only purpose is to let Security Rules verify, inside the same atomic write, that a membership
was created with a real and active code for that organization. Without it, the membership create
rule would have nothing to check: the code the user typed leaves no trace on the membership itself.

The code is kept here rather than on the membership so that a colleague reading a member directory
entry learns nothing about how that member joined.

Client access:

- `get` — the subject, or the Admin of that organization.
- `list` — denied to everyone.
- `create` — only as part of a valid join batch, alongside the membership it proves.
- `update` and `delete` — denied. A proof is a historical fact.

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
  /** One of the twelve MVP categories in PROJECT_SPEC section 7.4. */
  category: string;
  team_id: string;            // required — every item has an owning team
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
- sum of condition counts must not exceed `quantity_total`,
- `team_id` is required and must name a team in the same organization,
- `category` must be one of the twelve MVP categories listed in `PROJECT_SPEC.md` section 7.4.

`category` is a fixed set rather than free text. The category filter needs a stable list to offer,
and two people typing "Lighting" and "lighting instruments" for the same shelf would split the
inventory in a way no filter could put back together. Security Rules hold the same list, so an
unsupported value is rejected rather than quietly stored.

`team_id` is **required**. An item with no owning team would be editable by nobody but the Admin,
which makes it useless to the crew that actually handles it. An organization that keeps shared
equipment creates a team for it — General or Shared Equipment — rather than leaving the field
empty. There is no team-less inventory model in the MVP.

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
  team_id: string;           // required — copied from the linked item at creation
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

`team_id` is a deliberate denormalization and is **required**. It is copied from the linked
inventory item when the record is created, so Security Rules can evaluate team scope with a single
document read instead of joining back to `inventory_items` on every write. Rules verify at creation
that it equals the linked item's team, and it is immutable afterwards.

It is a **historical snapshot**. If the item's owning team changes later, existing maintenance
records keep the team they were filed under, because that is who actually sent the equipment out.
Where the two differ, the interface says so explicitly rather than showing a team that was never
responsible for the repair.

Per-record validation, enforced by Security Rules:

- `quantity_sent` is an integer greater than zero,
- `quantity_sent` does not exceed the linked item's `quantity_total`,
- `status` is one of the six values above,
- `item_id` names an item in the same organization.

**The aggregate is not an invariant.** The sum of `quantity_sent` across an item's active records
may exceed its `quantity_total`, and nothing rejects that. Security Rules cannot enforce it:
they have no query capability, so summing an unknown set of sibling documents is impossible, and a
check that lived only in the client would look like a boundary without being one. It is also not
always wrong — reducing `quantity_total` after equipment is scrapped can produce it from correct
data. The interface warns when a write would produce that state and still lets the user save.

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
interface ProductionRequirement {
  requirement_id: string;
  organization_id: string;
  production_id: string;
  item_name: string;
  inventory_item_id?: string;
  required_qty: number;
  team_id: string;           // required — the crew responsible for this need
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

`required_qty` is an integer greater than zero. `team_id` is required and names the crew
responsible; it is what edit scope is judged against. The linked inventory item does **not** have
to belong to that team — a stage manager matching a sound requirement to a lighting item is normal
theater practice, and decision 40 depends on it being possible.

**Availability comes from `quantity_available` alone.** Quantity currently in service is a separate
derived indicator and is never subtracted here; see decision 46.

A requirement carries **no action type**. The plan is the Action Item, which is the only place it is
persisted; a second copy here could disagree with it. Already Available is derived from a shortage
of zero and is never stored. See decision 48.

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
  team_id: string;           // copied from the requirement; must match it
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

## 13b. inventory_units

Path:

`inventory_units/{unitId}`

One physical object, for items whose `tracking_mode` is `serialized`. Bulk items
have none.

```ts
type TrackingMode = 'bulk' | 'serialized';
type UnitStatus = 'available' | 'in_use' | 'in_maintenance' | 'lost' | 'retired';
type RetirementReason = 'disposed' | 'permanently_lost' | 'donated' | 'sold' | 'other';

interface InventoryUnit {
  unit_id: string;
  organization_id: string;        // immutable, copied from the parent
  inventory_item_id: string;      // immutable, copied from the parent
  team_id: string;                // immutable, the parent's owning team
  asset_code: string;             // the label a person reads, e.g. CLAMP-017
  condition: ConditionKey;
  status: UnitStatus;
  storage_location: string;
  retirement_reason?: RetirementReason;   // required when retired, absent otherwise
  using_team_id?: string;                 // present only while in use
  using_member_uid?: string;
  checked_out_at?: Timestamp;
  last_known_location?: string;
  last_inspected_at?: Timestamp;
  notes?: string;
  created_by_uid: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

The three copied fields exist so Security Rules can authorize a write without
reading the parent — see decision 65. All three are immutable, and there is no
delete: equipment leaves by being retired, which keeps its history.

Condition and status are separate axes. A unit can be unusable and on the shelf,
or excellent and given away.

### 13c. inventory_items additions

```ts
interface InventoryItem {
  // ... existing fields
  tracking_mode?: TrackingMode;   // absent means bulk
  unit_counts?: UnitCounts;       // serialized only
}

interface UnitCounts {
  active_total: number;        // status != retired
  available: number;           // status == available AND condition != unusable
  unusable_on_hand: number;    // status == available AND condition == unusable
  in_use: number;
  in_maintenance: number;
  lost: number;
  retired: number;             // beside the active total, not inside it
}
```

Invariant, enforced in Rules:

```
active_total == available + unusable_on_hand + in_use + in_maintenance + lost
```

For a serialized item, `quantity_total`, `quantity_available`, and
`condition_counts` mirror the units — `quantity_available` equals
`unit_counts.available`, `quantity_total` equals `active_total`, and the
condition counts cover every non-retired unit exactly. Everything that already
reads those fields keeps working without learning that units exist.

For a bulk item they remain what they always were: numbers a person maintains,
with condition counts allowed to fall short of the total.

### 13c-i. Unit ownership

`inventory_units.team_id` is the unit's own owning team, not a copy of its
parent's. Units of one item may belong to different crews, and a unit may change
hands: the field is settable at creation and editable afterwards, with Rules
checking the actor's authority over both the team it has and the team it is
going to.

For a **bulk** item, `inventory_items.team_id` is the owning team exactly as
before. For a **serialized** item it is the default a new unit starts from, and
is not presented as the ownership of every unit. Likewise `location` and
`last_inspected_at`: unchanged for bulk items, and not shown as shared facts for
serialized ones.

### 13c-ii. Who may write what

| Write | Bulk | Serialized |
|---|---|---|
| Item metadata (name, category, team, location, notes) | item's team | item's team |
| Item mirrors (`unit_counts`, quantities, `condition_counts`) | item's team | **any inventory editor** |
| Unit create / edit | — | the unit's own team |
| Unit ownership transfer | — | both the old and the new team |

The mirrors are the exception because a unit's owner may sit under another
crew's item, and every unit operation moves those numbers.

### 13d. How the mirrors are kept in step

Units and their parent's mirrors are written together in one transaction. The
parent is read inside that transaction, so concurrent writers are serialized
rather than losing each other's counts, and the whole batch either lands or does
not.

An entire batch fits in one transaction. Security Rules charge for each distinct
document read, and every unit of an item reads the same parent, so a batch of
units costs one access call regardless of size — measured at four hundred units
plus their parent in `tests/rules/inventory-unit-transactions.test.ts`. What the
budget of twenty actually limits is a batch spanning many *different* parents.

Rules can check that the stored numbers are internally consistent. They cannot
count documents, so they cannot check that the numbers match reality; that is
what the transaction is for.

## 13e. asset_events

```ts
interface AssetEvent {
  event_id: string;
  organization_id: string;
  inventory_item_id: string;
  inventory_unit_id: string;

  event_type: 'marked_in_use' | 'checked_in' | 'marked_lost' | 'marked_found' | 'retired';
  from_status: UnitStatus;
  to_status: UnitStatus;

  using_team_id?: string;    // who is taking it, or who had it
  using_member_uid?: string;
  retirement_reason?: RetirementReason;   // retirements only
  note?: string;

  actor_uid: string;
  occurred_at: Timestamp;
}
```

`inventory_units.last_lifecycle_event_id` names the event that produced the
unit's current status. Optional — absent until a unit first moves, which
includes one registered while already out or already missing. Rules require it
to change on every status change and to name an event describing exactly that
move, and require an event's `from_status`/`to_status` to match the unit before
and after the same batch. Neither document can exist without the other, so a
status change cannot happen without history and history cannot be fabricated
without a status change. An edit that leaves the status alone must leave this
field alone.

Append-only: no update, no delete, for anyone. Not the source of truth — the unit
document is authoritative for current state, and events are never replayed to
derive it.

Written in the same transaction as the unit and its parent's mirrors. Rules link
the event to the unit's post-transaction state with `getAfter()`, so `to_status`
must be what the unit actually became.

Queried by `organization_id` + `inventory_unit_id`, two equality filters that
single-field indexes already serve; ordering is done in the client, so
`firestore.indexes.json` stays empty.

## 13f. Unit-level maintenance

`maintenance_records` gains two optional fields:

```ts
tracking_mode?: 'bulk' | 'serialized'   // absent means bulk
unit_ids?: string[]                     // serialized only, immutable once written
```

`quantity_sent` stays authoritative for a bulk repair and mirrors
`unit_ids.length` for a serialized one, so the dashboard and the in-service sum
keep working unchanged.

`inventory_units` gains two more:

```ts
current_maintenance_record_id?: string  // required exactly while in_maintenance
maintenance_record_ids?: string[]       // append-only, one entry per visit
planned_maintenance_record_id?: string  // at most one open plan; reserves nothing
```

`planned_maintenance_record_id` is advisory metadata, not a lifecycle state. A
unit carrying one may still be used, checked in, lost, or retired; the plan
survives all of it. Availability is checked again when the repair starts, and
starting clears the pointer.

A serialized repair is one transaction over the whole batch: every unit, the
parent's counts, the record, and **one shared** `asset_events` entry naming all
of them. Sharing the event is what keeps the Rules access-call cost flat — a
per-unit event ran out at six units; the shared one carries 200.

Rules require the parent's `unit_counts.in_maintenance` to move by exactly
`unit_ids.length` when a repair starts, by `-unit_ids.length` when it ends, and
not at all for the workflow steps in between. That is how a record claiming more
equipment than actually moved is caught.

Serialized repairs may be recorded at `planned` (an intention, which moves no
equipment) or at `sent`, `in_service`, or `ready` — any stage where the equipment
is away. Never at `returned` or `cancelled`. Whichever is chosen, the units move `available → in_maintenance`
exactly once. Return and
cancellation move every listed unit back together; there is no partial return.

## 13g. Equipment labels and deep links

No collection, no document, and no field. A QR label is derived entirely from
data that already exists.

The code encodes one string:

```
https://theater-inventory.web.app/equipment/<inventory_units document id>
```

Nothing else. No token, no signature, no `organization_id`, no asset code, and
nothing about the equipment. The origin is a compiled-in constant, overridable
with the optional, non-secret `VITE_PUBLIC_APP_ORIGIN`, and never taken from
`window.location` — a label generated on `localhost` would otherwise be printed
and permanently useless. The override must be an absolute `https:` URL with a
host and no credentials, path, query, or fragment; anything else falls back to
the constant rather than being printed.

The document id is the identity because it is the only field that never changes.
Asset codes are edited; a label keyed to one would silently stop resolving the
day somebody fixed a typo. Status, team, condition, repairs, loss, and retirement
all leave the link untouched, so a label is printed once.

What is printed alongside the code — asset code, item name, organization name —
is limited to fields whose value on a sticker stays true. Status, condition,
storage location, owning team, holder, current repair, and notes are excluded:
they change while the sticker does not, and a confidently wrong label is worse
than none.

Authorization is unchanged by any of this. Opening the link requires signing in,
and the unit read is gated on the document's own `organization_id`, exactly as
every other inventory read is. Because Rules dereference `resource.data`, a
request for a unit that does not exist is denied rather than returning an empty
snapshot — so "no such equipment" and "not your equipment" are indistinguishable
to a client, and the interface reports them as one. See decisions 89 to 89e.

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
- calendar events by organization (a single equality filter; the month is selected on the client, so no composite index is needed),
- memberships by uid + is_active (Organization Selection),
- memberships by organization_id + is_active (member directory).

Two collections are never queried, only fetched by document ID, and therefore need no index:
`organization_join_codes` and `organization_admin_settings`. That is a security property, not an
optimization — see sections 6 and 6b.

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

Join codes are never deleted. A superseded code keeps its document with `active: false` and a
`revoked_at` timestamp, so a code is never silently reused and a revoked code fails validation for
a clear reason rather than looking like a typo.

Join proofs are never deleted or updated. They record a historical fact.

`calendar_events` is the one collection the MVP does allow deleting, by an Admin or anyone with
`calendar` edit. A cancelled rehearsal is not history the way a repair record or an action item is,
and `IA.md` section 9.2 puts a delete control on the event. Nothing references an event, so the
deletion orphans nothing.
