# Theater Inventory Tracker — Project Specification

## 1. Project Summary

Theater Inventory Tracker is a responsive web application for high school theater departments and stage crews.

Its purpose is to help theater teams answer operational questions such as:

- What equipment and materials do we own?
- Where are they stored?
- What condition are they in?
- What is currently available?
- What equipment is being repaired?
- When will repaired equipment return?
- What does an upcoming production require?
- What are we missing for that production?
- What needs to be bought, rented, built, or repaired?
- What events and deadlines are coming up?
- Which team members are allowed to view or edit which information?

The application should feel like a believable internal theater-management tool, not a generic classroom CRUD exercise.

Target completion date: **September 5, 2026**.

## 2. Product Goals

The MVP must:

1. Solve a real theater-department inventory and production-planning problem.
2. Provide persistent organization-specific data.
3. Work on desktop and mobile browsers.
4. Provide a clean and understandable user experience.
5. Support multiple theater organizations per user account.
6. Support team/member permissions.
7. Track maintenance and repair history.
8. Compare production requirements with current inventory.
9. Generate practical action items from shortages.
10. Provide a shared calendar.
11. Include two meaningful AI features:
   - AI Smart Search
   - AI Requirement Generator
12. Remain understandable enough for a high school student to explain the architecture and core logic.

## 3. Target Users

Primary users:

- Theater director / faculty supervisor
- Stage manager
- Lighting technicians
- Sound technicians
- Scenic / set team
- Props team
- Costume team
- Other student technicians

## 4. Platform

- Responsive web application
- Desktop-first administration experience
- Fully usable from a phone browser for common tasks
- No native iOS or Android app required

## 5. Account and Organization Model

A user first creates a personal account.

The account itself does not automatically belong to a theater organization.

After login, a user lands on the Organization Selection page where they may:

- select an organization they already belong to,
- create a new organization,
- or join an existing organization using an organization code.

A user may belong to multiple organizations at the same time.

Roles, team memberships, and permissions are stored per organization membership.

### Creating an organization

When a user creates an organization:

- the organization is created,
- the creator becomes the first Admin,
- a join code is generated,
- the Admin may share the join code with other users.

### Joining an organization

When a user joins using a valid organization code:

- they become a member of that organization,
- their initial membership status is `unassigned`,
- they receive no normal operational access until an Admin assigns teams/permissions,
- assignment is what promotes them: saving at least one team together with at least one module
  permission at View or Edit changes the role to Member automatically, and a membership that stops
  meeting both conditions returns to Unassigned.

Creating an organization, joining by code, regenerating a code, and transferring Admin run in the
client as Firestore transactions or batched writes, authorized entirely by Security Rules. The
organization code is stored separately from the organization record, and only the Admin can learn
which code is currently active.

## 6. Roles

### Admin

The Admin has full access to the organization and can:

- edit organization settings,
- manage organization code,
- manage teams,
- manage members,
- assign team memberships,
- assign permissions,
- manage inventory,
- manage repairs,
- manage productions,
- manage action items,
- manage calendar events,
- transfer Admin responsibility.

### Member

A Member has been assigned to one or more teams and receives module access according to permissions.

### Unassigned Member

A newly joined user who has not yet been assigned by an Admin.

Unassigned members cannot use normal organization-management modules.

## 7. Main Functional Areas

### 7.1 Authentication

- Sign Up
- Log In
- Change password
- Personal profile

### 7.2 Organizations

- Organization Selection
- Create Organization
- Organization code generation
- Join Organization by code
- Unassigned Member state
- Organization switching
- Organization settings
- Admin transfer

### 7.3 Dashboard

Provide a fast overview of the active organization.

Suggested summary information:

- total inventory records,
- items needing repair,
- items currently in service,
- active productions,
- unresolved action items,
- upcoming calendar events.

Exact card layout belongs to the UI design stage.

### 7.4 Inventory

Users with permission can:

- view inventory,
- search inventory,
- filter inventory,
- create items,
- edit items,
- view item details,
- inspect condition counts,
- view available quantity,
- view linked repair history,
- view linked production requirements.

Inventory categories — the MVP set. These twelve values are the complete allowed list, not
examples, and Security Rules reject anything else:

- Lighting Instruments
- Cables
- Lighting Accessories
- Sound Equipment
- Microphones
- Tools
- Set-Building Materials
- Platforms / Flats
- Props
- Costumes
- Hardware
- Miscellaneous Technical Equipment

Condition categories:

- Excellent
- Good
- Fair
- Needs Repair
- Unusable

Available quantity is maintained by hand and is the authoritative figure. The quantity currently
out for service is computed from repair records and displayed beside it, without changing it.

### 7.5 Maintenance and Repair

The system must store repair history including:

- related inventory item,
- issue description,
- quantity sent,
- repair status,
- date sent,
- expected pickup/delivery date,
- actual returned date,
- return method,
- service provider name,
- service provider phone,
- optional provider email,
- optional cost,
- repair notes.

Maintenance records are historical records and should not disappear after an item is returned.

### 7.6 Productions

Users can create theater productions such as:

- Spring Musical
- Fall Play
- School Festival Performance

A production contains production requirements.

Each requirement stores:

- item/material name,
- optional linked inventory item,
- required quantity,
- responsible team,
- intended shortage action,
- notes.

Available quantity and shortage quantity are shown on screen but are **not stored**. They are
recomputed from the linked inventory item each time the requirement is displayed.

Exact shortage calculation:

`shortage_qty = max(required_qty - available_qty, 0)`

This calculation must be deterministic application logic, not AI output.

A requirement with no linked inventory item is Not Matched: available quantity is null rather than
zero, and no shortage is calculated until a real item is linked.

### 7.7 Action List

When production shortages require work, the system supports these action types:

- Buy
- Rent
- Build
- Repair

Already Available is not an action type. It is the derived state of a requirement whose shortage
is zero, and it produces no task.

Each requirement has at most one action item, created or updated when the user chooses an action
type. Access to the Action List follows the Productions permission.

An actionable task may contain:

- title / item,
- related production requirement,
- action type,
- quantity,
- responsible team,
- optional assignee,
- optional due date,
- status,
- notes.

### 7.8 Calendar

The calendar allows users to create dated organization events.

Examples:

- rehearsal,
- build day,
- equipment inspection,
- repair return/pickup,
- production deadline.

Events may target:

- all teams,
- or one or more specific teams.

Team targeting drives filtering and labelling in the interface. It is not a read restriction:
anyone who may view the calendar sees the whole organization's schedule.

Events may optionally link to:

- a production,
- or a repair record.

### 7.9 Teams and Permissions

An organization may contain multiple theater teams.

Examples:

- Lighting
- Sound
- Scenic / Set
- Props
- Costume
- Stage Management

Admins assign users to one or more teams and configure what modules they can view or edit. A
member holding at least one team and at least one module at View or Edit is a Member; a membership
that does not meet both conditions is an Unassigned Member.

Permission modules:

- Inventory
- Maintenance
- Productions
- Calendar

Permission levels:

- none
- view
- edit

The Dashboard and the Action List have no permission of their own. Dashboard cards follow the
module each card summarizes, and the Action List follows Productions. Team assignment scopes
editing within inventory, maintenance, production requirements, and action items; productions,
calendar events, and teams are organization-level.

### 7.10 Required AI Features

#### AI Smart Search

Users may search inventory in natural language.

Example:

“Show available microphones that need repair.”

AI interprets the intent into supported structured filters. Firestore returns the actual matching records.

AI must never fabricate inventory items.

#### AI Requirement Generator

A user provides a production description.

AI proposes an initial list of equipment/material requirements.

The user may:

- accept,
- edit,
- remove,
- or regenerate suggestions.

No AI suggestion is saved until the user approves it.

## 8. Technical Architecture

Frontend:

- React
- Vite
- TypeScript
- React Router
- Tailwind CSS
- shadcn/ui

Backend platform:

- Firebase Authentication
- Cloud Firestore
- Firebase Hosting
- **Firebase Spark plan only.** No Cloud Functions, no Admin SDK, no Cloud Run, and no feature
  requiring Blaze. There is no trusted server; Firestore Security Rules are the authorization
  boundary.

AI:

- Firebase AI Logic with the **Gemini Developer API**, model **gemini-3.5-flash**
- The Vertex AI / Agent Platform path requires Blaze and is not used
- AI access wrapped behind an internal application service
- Zod for runtime validation of all model output

Testing:

- Vitest
- @firebase/rules-unit-testing with the Firebase Emulator Suite for Security Rules

## 9. MVP Non-Goals

Do not prioritize these before the core MVP is complete:

- public organization directory,
- organization search,
- social login,
- real email invitations,
- checkout/check-in workflow,
- barcode system,
- QR scanning,
- equipment photos,
- push notifications,
- complex analytics,
- accounting system,
- rental vendor marketplace,
- live chat,
- advanced recurring calendar rules,
- enterprise audit system.

## 10. Success Criteria

The project is considered successful when a demo user can complete this scenario:

1. Create an account.
2. Create a theater organization.
3. Receive an organization code.
4. A second account joins using the code.
5. The second account appears as Unassigned.
6. The Admin assigns that user to a team with permissions.
7. The team creates and manages inventory records.
8. A repair record is created and later visible in item history.
9. A production is created.
10. Production requirements are added manually or with AI assistance.
11. The application compares requirements with inventory.
12. Shortages are visible and turned into action items.
13. A calendar event is created.
14. AI Smart Search successfully interprets a natural-language inventory query.
15. Organization data remains isolated from other organizations.
16. The experience works on both desktop and mobile.
