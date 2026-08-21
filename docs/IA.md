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
- Action List
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
- organization and Admin membership should be created atomically or through a trusted backend operation.

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
- notes,
- optional photo later.

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
- linked production requirements,
- optional QR link later.

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
- AI must not invent records.

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
- when status becomes Returned, prompt the user to review inventory condition/availability.

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
- link to Action List.

Rules:

`shortage_qty = max(required_qty - available_qty, 0)`

If shortage is zero, the state may be shown as Already Available.

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
- likely responsible team,
- possible inventory match,
- short rationale.

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

## 8. Action List

### 8.1 Purchase / Build / Repair Action List

Purpose: Convert production shortages into practical tasks.

Action types:

- buy,
- rent,
- build,
- repair,
- already_available.

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

Suggested task statuses:

- todo,
- in_progress,
- done,
- cancelled.

## 9. Calendar

### 9.1 Calendar

Purpose: Provide a shared dated schedule for the active organization.

Content:

- month view,
- upcoming-event list on mobile or secondary panel,
- filters for all teams / specific team,
- Create Event button if permitted.

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
- visibility: all teams or selected team,
- optional linked production,
- optional linked repair record,
- memo/notes.

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

### 10.2 Member Detail

Purpose: Manage one user's membership inside the active organization.

Content:

- display name,
- user ID,
- join date,
- membership role/status,
- team memberships,
- module permissions,
- deactivate/remove membership if implemented,
- make Admin / transfer Admin through the approved flow.

### 10.3 Permission Matrix

Purpose: Clearly configure module access.

Permission levels:

- None
- View
- Edit

Modules:

- Dashboard
- Inventory
- Maintenance
- Productions
- Action List
- Calendar

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

### 11.2 Transfer Admin

Purpose: Transfer Admin responsibility without leaving the organization without an Admin.

Content:

- current Admin,
- eligible member selector,
- clear warning,
- confirmation.

Rules:

- target must already be a member of the organization,
- transfer must be atomic,
- previous Admin becomes a normal Member unless multiple-Admin support is intentionally introduced later,
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

This is not part of the required MVP and must not delay core features.
