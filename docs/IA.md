# Theater Inventory Tracker — Information Architecture

This document is the text source of truth for page structure and navigation.

## 1. Global Navigation Model

### Before organization selection

- Sign Up
- Log In
- Organization Selection
- Create Organization
- Join Organization
- Profile / Account Settings

### Inside an active organization

- Dashboard
- Inventory
- Maintenance & Repair
- Productions
- Needs & Actions
- Calendar
- Team & Member Management
- Organization Settings

The current organization must always be explicit in application state.

## 2. Authentication

### 2.1 Sign Up

Purpose: Create a personal user account before joining or creating an organization.

Content:

- User ID
- Display name
- Password
- Confirm password
- Validation errors
- Link to Log In

Core components:

- SignUpCard
- UserIdInput
- DisplayNameInput
- PasswordInput
- ConfirmPasswordInput
- ShowPasswordToggle
- SubmitButton

Rules:

- User ID is unique.
- User ID is independent from organization membership.
- One user may join multiple organizations.
- Social login is not required.

### 2.2 Log In

Purpose: Authenticate an existing user and load their organization memberships.

Content:

- User ID
- Password
- Show/hide password
- Authentication error
- Link to Sign Up

After success:

- always route to Organization Selection,
- do not directly open a previous organization unless this behavior is added later.

## 3. Organizations

### 3.1 Organization Selection

Purpose: Let the user choose which organization context to enter.

Content:

- list of organizations the current user belongs to,
- organization name,
- user's role/status in that organization,
- optional team summary,
- Create Organization button,
- Join Organization button,
- empty state if the user belongs to no organizations.

Example organization card data:

- organization name,
- role: Admin / Member / Unassigned,
- team names,
- Enter button.

Selecting a normal organization membership opens its Dashboard.

Selecting an unassigned organization membership opens the Unassigned Member State.

### 3.2 Create Organization

Purpose: Create a new theater organization.

Content:

- organization name,
- optional description,
- Create button.

Rules:

- current user becomes the first Admin,
- join code is generated automatically,
- the organization, the creator's membership, the admin settings, and the join code are created
  in one atomic batched write from the client, validated as a unit by Security Rules.

### 3.3 Organization Created / Invite Code

Purpose: Confirm successful creation and provide the join code.

Content:

- organization name,
- generated organization code,
- copy code button,
- explanation that the code can be shared with members,
- Enter Organization button.

### 3.4 Join Organization

Purpose: Join an existing organization using an organization code.

Content:

- organization code input,
- validation/error state,
- organization preview after a valid code,
- Join confirmation.

Rules:

- user cannot join the same organization twice,
- successful join creates an `unassigned` membership,
- organization code does not grant operational permissions by itself.

### 3.5 Unassigned Member State

Purpose: Clearly explain why a newly joined user does not yet have normal access.

Content:

- organization name,
- membership status: Unassigned,
- message explaining that an Admin must assign a team/permissions,
- option to return to Organization Selection.

Unassigned users must not see normal organization management pages.

## 4. Dashboard

### 4.1 Dashboard

Purpose: Provide a high-level view of the selected organization.

Suggested summary cards:

- Total Inventory Records
- Needs Repair
- Currently in Service
- Active Productions
- Unresolved Actions
- Upcoming Events

Additional content:

- recent repairs,
- upcoming calendar events,
- active production summary,
- quick links based on permission.

The exact visual content of cards is a UI design decision, but all values must be derived from organization-scoped real data.

Dashboard has no permission of its own. Each card renders only when the user can view the module
it summarizes:

- inventory totals require `inventory` view,
- needs-repair and in-service figures require `maintenance` view,
- active productions and unresolved actions require `productions` view,
- upcoming events require `calendar` view.

A user with no viewable module sees an empty-state dashboard, not a broken one.

## 5. Inventory

### 5.1 Inventory List

Purpose: Answer what the organization owns, where it is, what condition it is in, and what is available.

Content:

- standard search,
- AI Smart Search entry,
- filters by team,
- category,
- location,
- condition,
- availability,
- sort by name / last inspection,
- Add Item button if permitted,
- desktop table / mobile card list.

Core displayed item data:

- name,
- category,
- owning team,
- total quantity,
- available quantity,
- location,
- condition summary,
- last inspected date.

### 5.2 Add / Edit Inventory Item

Purpose: Create or update one structured inventory record.

Fields:

- item name,
- category,
- owning team,
- total quantity,
- available quantity,
- condition counts,
- storage location,
- last inspection date,
- notes.

Item photos are not part of the MVP.

Condition counts:

- excellent,
- good,
- fair,
- needs repair,
- unusable.

Validation:

- available quantity cannot exceed total quantity,
- condition-count total cannot exceed total quantity,
- organization ID is taken from active organization context, not user input.

Available quantity is entered and maintained by hand. No other screen changes it automatically.

### 5.3 Inventory Item Detail

Purpose: Serve as the central record for one inventory item.

Content:

- item information,
- quantity and availability,
- condition breakdown,
- location,
- notes,
- edit button if permitted,
- maintenance / repair history,
- linked production requirements.

The condition summary shown here is derived from the condition counts, not stored: the worst
state holding at least one unit, with any remainder shown as Unclassified. QR links are not part
of the MVP.

### 5.4 AI Smart Search

Purpose: Let users search inventory with natural language.

Examples:

- “Show available microphones.”
- “Which lighting equipment needs repair?”
- “Show cables stored in Lighting Storage A.”

Content:

- natural-language search input,
- example prompt chips,
- interpreted filter summary,
- applied filter chips,
- real inventory result list,
- clear/reset action,
- ambiguity/error state.

Rules:

- AI only interprets intent,
- Firestore provides actual records,
- organization/permission scope applies before results are shown,
- AI must not invent records,
- AI must not emit Firestore document IDs. It returns a team **name**, which the application
  resolves against the organization's real teams,
- interpreted conditions are always a list, so queries such as "damaged or unusable" work.

## 6. Maintenance & Repair

### 6.1 Maintenance Overview

Purpose: Show broken, unavailable, and externally serviced equipment.

Content:

- items needing repair,
- unusable items,
- equipment currently sent for service,
- expected return dates,
- overdue repairs,
- filter by team,
- filter by status,
- Add Repair Record button.

Repair statuses:

- planned,
- sent,
- in_service,
- ready,
- returned,
- cancelled.

Quantity currently in service is computed by summing quantity sent across `sent`, `in_service`,
and `ready` records. It is displayed next to the item's available quantity and never modifies it.

### 6.2 Repair / Service Record

Purpose: Create or edit a permanent repair/service history entry.

Fields:

- inventory item,
- quantity sent,
- issue description,
- status,
- sent date,
- return method,
- expected return date,
- actual returned date,
- service provider name,
- service provider phone,
- optional service provider email,
- optional cost,
- repair notes.

Rules:

- returned records remain in history,
- when status becomes Returned, prompt the user to review inventory condition/availability. The
  application does not change either value on its own,
- the record stores its own owning team, copied from the inventory item when it is created.

## 7. Productions

### 7.1 Production List

Purpose: Show current and archived theater productions.

Content:

- production cards,
- Planning / Active / Completed filters,
- Create Production button,
- basic requirement/action progress.

Recommended ProductionCard information:

- title,
- date range,
- status,
- requirement count,
- unresolved action count.

Detailed visual arrangement belongs to UI design.

### 7.2 Production Detail / Requirements

Purpose: Plan what a production needs and compare requirements to inventory.

Content:

- production summary,
- requirement list,
- Add Requirement button,
- Generate Requirements with AI button,
- linked inventory item,
- required quantity,
- actual available quantity,
- shortage quantity,
- responsible team,
- action type/status,
- link to Needs & Actions.

Rules:

`shortage_qty = max(required_qty - available_qty, 0)`

Available quantity and shortage are computed from the linked inventory item every time the page
loads. Neither is stored on the requirement.

If shortage is zero, the state is shown as Already Available.

A requirement with no linked inventory item is **Not Matched**: available quantity is null rather
than zero, no shortage is calculated, and no action item can be created from it.

### 7.3 AI Requirement Generator

Purpose: Generate an editable first draft of production equipment/material requirements.

Input:

- production title,
- production description,
- optional production notes,
- existing requirements,
- organization inventory summary/matching candidates.

AI output may suggest:

- item/material name,
- suggested quantity,
- category,
- likely responsible team, as a **name**,
- a possible inventory match, as a **search keyword**,
- short rationale.

The model never returns a team ID or an inventory item ID. The application resolves both against
real organization data and shows the proposed match for the user to confirm or correct.

User actions:

- Accept
- Edit
- Remove
- Regenerate
- Add Selected Requirements

Rules:

- suggestions are never saved automatically,
- user approval is mandatory,
- availability and shortage calculations use real application data after approval.

### 7.4 Add / Edit Production Requirement

Purpose: Manually create or edit one production need.

Fields:

- free-text item/material name,
- optional linked inventory item,
- required quantity,
- responsible team,
- preferred action type,
- notes.

## 8. Needs & Actions

### 8.1 Purchase / Build / Repair Actions

Purpose: Convert production shortages into practical tasks.

Needs & Actions has no permission of its own; it follows the `productions` permission.

Action types:

- buy,
- rent,
- build,
- repair.

`already_available` is not an action type. It is the derived state of a requirement whose
shortage is zero, and it produces no action item.

Content:

- related production,
- related requirement,
- item/material,
- quantity,
- action type,
- responsible team,
- optional assignee,
- optional due date,
- task status,
- notes.

Task statuses:

- todo,
- in_progress,
- done,
- cancelled.

Rules:

- one action item per requirement at most; the action item's document ID is the requirement ID,
- an action item is created or updated only when the user chooses a shortage action type,
- nothing is created for a Not Matched requirement, a zero shortage, or an Already Available
  state,
- if a shortage later drops to zero, mark the action item done or cancelled rather than deleting
  it.

## 9. Calendar

### 9.1 Calendar

Purpose: Provide a shared dated schedule for the active organization.

Content:

- month view,
- upcoming-event list on mobile or secondary panel,
- filters by team and event type,
- Create Event button if permitted.

An event may be addressed to all teams or to several specific teams. Team visibility is a display
filter, not a security boundary: anyone with calendar view permission can read every event in the
organization.

Event examples:

- rehearsal,
- build day,
- equipment inspection,
- repair pickup/return,
- production deadline.

### 9.2 Create / Edit Calendar Event

Fields:

- title,
- date,
- optional start time,
- optional end time,
- event type,
- visibility: all teams, or one or more selected teams,
- optional linked production,
- optional linked repair record,
- memo/notes.

Date and time are separate. Leaving both times empty makes the event an all-day item such as a
build day. Recurring events are not part of the MVP.

Events may be edited and deleted by Admins and by users with calendar edit permission. Linked
records must belong to the active organization.

## 10. Team & Member Management

### 10.1 Team & Member Management

Purpose: Let Admins organize members after they join.

Content:

- teams list,
- create/edit team,
- members list,
- Unassigned Members section,
- member status,
- member team summary,
- open Member Detail.

There is no Add Member flow. Members appear here only after joining with the organization code.
Teams have no delete action in the MVP.

### 10.2 Member Detail

Purpose: Manage one user's membership inside the active organization.

Content:

- display name,
- user ID,
- join date,
- membership role/status,
- team memberships,
- module permissions,
- deactivate membership.

Rules:

- saving at least one team together with at least one module permission at View or Edit promotes
  an Unassigned member to Member automatically, and removing them drops the member back to
  Unassigned. There is no manual role control for this,
- Admin is not granted here. Use Transfer Admin in Organization Settings,
- removal is deactivation, not deletion: `is_active` becomes false, preserving the member's
  historical references. The current Admin's membership cannot be deactivated.

### 10.3 Permission Matrix

Purpose: Clearly configure module access.

Permission levels:

- None
- View
- Edit

Modules:

- Inventory
- Maintenance
- Productions
- Calendar

Dashboard and Needs & Actions are deliberately absent. Dashboard cards follow the module each card
summarizes; Needs & Actions follows Productions.

Team assignment is a separate control on the same screen. Permission decides which module and
whether the user may write; team decides which records inside the team-scoped modules —
inventory, maintenance, production requirements, and action items. Productions, calendar events,
and teams are organization-level and are not team-scoped.

Administrative modules remain Admin-only unless explicitly expanded later.

## 11. Settings

### 11.1 Organization Settings

Admin-only organization settings.

Content:

- organization name,
- description,
- current join code,
- copy code,
- regenerate code,
- current Admin information,
- Transfer Admin entry.

The join code is not stored on the organization record; it is read from the join-code collection
and is visible to the Admin only — members and unassigned users cannot read it anywhere in the
application. Only an Admin may regenerate it, through an atomic batched write that revokes the
previous code and repoints the organization's current-code setting.

### 11.2 Transfer Admin

Purpose: Transfer Admin responsibility without leaving the organization without an Admin.

Content:

- current Admin,
- eligible member selector,
- clear warning,
- confirmation.

Rules:

- target must already be an active member of the organization,
- transfer must be atomic,
- the new Admin keeps their existing teams and permissions; admin access takes precedence while
  they hold the role,
- the previous Admin's role is resolved from the teams and permissions their membership already
  carries — Member if they have at least one team and at least one module at View or Edit,
  otherwise Unassigned Member,
- this screen has no controls for configuring the outgoing Admin's teams or permissions; that is
  done afterwards in Member Detail if needed,
- organization must always retain an Admin.

### 11.3 Profile / Account Settings

Purpose: Manage the personal user account, not an organization.

Content:

- display name,
- User ID read-only,
- password change,
- organization membership summary,
- sign out.

## 12. Optional Stretch Feature

### QR Scanner / Quick Item Lookup

Purpose: Let a technician scan a QR code attached to equipment and immediately open the corresponding Inventory Item Detail page.

This is not part of the required MVP and must not delay core features. Neither are item photos,
equipment checkout/check-in, notifications, advanced analytics, or recurring calendar events.
