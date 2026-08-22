# Theater Inventory Tracker — MVP Checklist

Target completion: **September 5, 2026**

This document defines what must be finished before optional stretch work begins.

## P0 — Required for Final Demo

### Project Foundation

- [ ] React + Vite + TypeScript project initializes correctly
- [ ] React Router configured
- [ ] Tailwind CSS configured
- [ ] shadcn/ui configured
- [ ] Firebase project connected
- [ ] Firebase Emulator Suite runs locally
- [ ] Vitest configured
- [ ] Zod configured for AI output validation
- [ ] @firebase/rules-unit-testing configured
- [ ] Blaze plan enabled for Cloud Functions
- [ ] Environment/config handling documented
- [ ] Git repository initialized
- [ ] Production build succeeds

### Authentication

- [ ] Sign Up with User ID + Password
- [ ] Log In with User ID + Password
- [ ] User profile created in Firestore
- [ ] Duplicate User ID handled
- [ ] Authentication errors shown cleanly
- [ ] Sign Out
- [ ] Change Password

### Organization Onboarding

- [ ] Organization Selection page
- [ ] Multiple organization memberships supported
- [ ] createOrganization Cloud Function
- [ ] joinOrganizationByCode Cloud Function
- [ ] regenerateOrganizationCode Cloud Function
- [ ] transferAdmin Cloud Function
- [ ] Create Organization
- [ ] Creator becomes Admin
- [ ] Join code generated in organization_join_codes with the code as document ID
- [ ] Join code never stored on the organization document
- [ ] Organization Created / code screen
- [ ] Join Organization by code
- [ ] Duplicate membership prevented
- [ ] New joiner becomes Unassigned
- [ ] Unassigned waiting state
- [ ] Organization switching

### Dashboard

- [ ] Dashboard loads active organization only
- [ ] Core summary cards use real data
- [ ] Each card hidden unless its underlying module is viewable
- [ ] Upcoming events summary
- [ ] Active production summary
- [ ] Permission-aware quick actions

### Teams / Members / Permissions

- [ ] Create/edit teams
- [ ] Members list
- [ ] Unassigned Members section
- [ ] Member Detail
- [ ] Assign one or more teams
- [ ] Assign the four module permissions (inventory, maintenance, productions, calendar)
- [ ] Automatic promotion to Member when a team plus a module at View or Edit is saved
- [ ] Fallback to Unassigned when teams or permissions no longer meet both conditions
- [ ] team_ids and permissions retained when a user becomes Admin
- [ ] Deactivate membership with is_active = false
- [ ] Current Admin's membership cannot be deactivated
- [ ] Admin full-access behavior
- [ ] Unassigned access restriction
- [ ] UI route guards
- [ ] Backend authorization rules

### Inventory

- [ ] Inventory List
- [ ] Desktop table
- [ ] Mobile card list
- [ ] Add Inventory Item
- [ ] Edit Inventory Item
- [ ] Inventory Item Detail
- [ ] Category filter
- [ ] Team filter
- [ ] Location filter
- [ ] Condition filter
- [ ] Availability filter
- [ ] Standard keyword search
- [ ] Quantity validation
- [ ] Condition-count validation
- [ ] Condition summary derived, not stored, with an Unclassified remainder
- [ ] Available quantity manually maintained and never auto-adjusted
- [ ] Organization scope enforced
- [ ] Team edit scope enforced

### AI Smart Search — REQUIRED AI FEATURE

- [ ] Natural-language input
- [ ] Structured filter output using team_name, never team_id
- [ ] Conditions returned as an array
- [ ] Runtime validation of AI output with Zod
- [ ] Display interpreted filters
- [ ] Query real Firestore inventory
- [ ] No fabricated inventory results
- [ ] Permission/org scope preserved
- [ ] Error/retry state
- [ ] Manual search remains available

### Maintenance & Repair

- [ ] Maintenance Overview
- [ ] Repair status filters
- [ ] Add Repair / Service Record
- [ ] Edit Repair / Service Record
- [ ] Issue description
- [ ] Quantity sent
- [ ] Sent date
- [ ] Expected return date
- [ ] Actual returned date
- [ ] Pickup/delivery method
- [ ] Service provider name
- [ ] Service provider phone
- [ ] Optional provider email
- [ ] Optional cost
- [ ] Repair notes
- [ ] Overdue state
- [ ] team_id copied from the inventory item on creation
- [ ] Currently-in-service quantity derived and shown beside available quantity
- [ ] Repair history visible from Inventory Item Detail

### Productions

- [ ] Production List
- [ ] Create Production
- [ ] Production Detail
- [ ] Production status
- [ ] Add/Edit Production Requirement
- [ ] Link requirement to inventory item
- [ ] Required quantity
- [ ] Real available quantity, derived not stored
- [ ] Deterministic shortage calculation, derived not stored
- [ ] Not Matched state for requirements with no linked inventory item
- [ ] Responsible team
- [ ] Requirement notes/action type

### AI Requirement Generator — REQUIRED AI FEATURE

- [ ] Production description input/context
- [ ] Generate Requirements with AI
- [ ] Structured suggestion validation with Zod
- [ ] Suggested item name
- [ ] Suggested quantity
- [ ] Suggested category and suggested_team_name when useful
- [ ] inventory_match_keyword returned instead of an inventory item ID
- [ ] Application resolves names and keywords to real IDs
- [ ] Inventory matching suggestions
- [ ] Accept suggestion
- [ ] Edit suggestion
- [ ] Remove suggestion
- [ ] Regenerate
- [ ] Save only approved suggestions
- [ ] No direct AI Firestore writes
- [ ] Shortages calculated after approval using real data
- [ ] Error/retry state

### Action List

- [ ] Action List page, gated by the productions permission
- [ ] Action item document ID equals requirement_id
- [ ] Created or updated only when the user chooses an action type
- [ ] Quantity defaults to the shortage and is never overwritten by later recalculation
- [ ] Current shortage displayed separately from action item quantity
- [ ] Never created for Not Matched, zero shortage, or Already Available
- [ ] Link action to production requirement
- [ ] Buy
- [ ] Rent
- [ ] Build
- [ ] Repair
- [ ] Quantity
- [ ] Responsible team
- [ ] Optional assignee
- [ ] Optional due date
- [ ] Status
- [ ] Notes
- [ ] Shortage dropping to zero marks the item done or cancelled instead of deleting it

### Calendar

- [ ] Calendar view
- [ ] Create Event
- [ ] Edit Event
- [ ] Event title
- [ ] Date/time
- [ ] Event type
- [ ] All Teams visibility
- [ ] Multiple specific teams via team_ids
- [ ] Date with optional start and end time
- [ ] Event with no times treated as all-day
- [ ] Team visibility treated as a display filter, not a security boundary
- [ ] Optional linked production
- [ ] Optional linked repair record
- [ ] Notes
- [ ] Mobile usability

### Organization Settings

- [ ] Edit organization name/description
- [ ] View/copy current join code
- [ ] Regenerate join code
- [ ] Old code becomes invalid
- [ ] Existing members remain unaffected
- [ ] Join code readable by Admin only
- [ ] Regenerate restricted to Admin
- [ ] Transfer Admin
- [ ] New Admin keeps existing teams and permissions
- [ ] Outgoing Admin resolved to Member or Unassigned by the assignment condition
- [ ] No extra UI for configuring the outgoing Admin
- [ ] Organization never has zero Admins

### Security

- [ ] Firestore Security Rules created alongside each collection, not retrofitted
- [ ] User cannot read unrelated organization data
- [ ] User cannot write unrelated organization data
- [ ] View permission cannot write
- [ ] None permission cannot read module
- [ ] Admin can access organization data
- [ ] Unassigned user blocked
- [ ] Deactivated membership blocked
- [ ] Team editing scope tested on the four team-scoped collections
- [ ] Organization-level collections editable without a team check
- [ ] Join code documents cannot be read by document ID
- [ ] Admin can list only their own organization's join code
- [ ] Privileged Cloud Functions verify caller authorization
- [ ] Rules covered by @firebase/rules-unit-testing against the emulator

### Responsive QA

- [ ] Sign Up / Login usable on mobile
- [ ] Organization Selection usable on mobile
- [ ] Dashboard usable on mobile
- [ ] Inventory usable on mobile
- [ ] Repair form usable on mobile
- [ ] Production Requirements usable on mobile
- [ ] Calendar usable on mobile
- [ ] Member management usable on mobile
- [ ] No critical horizontal overflow around 375px

### Final Demo / Delivery

- [ ] Seed/demo organization created
- [ ] Demo Admin account prepared
- [ ] Demo Member account prepared
- [ ] Demo inventory populated
- [ ] At least one repair history example
- [ ] At least one production with shortages
- [ ] At least one action item
- [ ] Calendar events populated
- [ ] AI Smart Search demo query prepared
- [ ] AI Requirement Generator demo production prepared
- [ ] Firebase Hosting deployment works
- [ ] README contains local run instructions
- [ ] No TypeScript errors
- [ ] Lint succeeds
- [ ] Production build succeeds

## P1 — Do Only If P0 Is Stable

- [ ] Inventory item photo upload
- [ ] QR code generation
- [ ] QR quick item lookup
- [ ] Better dashboard statistics
- [ ] Low-stock warning
- [ ] Additional production cost estimate
- [ ] Advanced sorting/filter presets

## Explicitly Defer Until After Deadline

- [ ] Equipment checkout/check-in
- [ ] Social login
- [ ] Public organization search
- [ ] Email invitation system
- [ ] Push notifications
- [ ] Complex recurring events
- [ ] Advanced audit logs
- [ ] Full accounting/purchasing integration

## Suggested Delivery Sequence

### Phase 1 — Foundation

- project setup
- docs review
- Firebase connection
- authentication

### Phase 2 — Organization Model

- organization selection
- create/join
- unassigned state
- team/member permission foundation

### Phase 3 — Core Theater Data

- inventory
- maintenance
- production requirements
- action list

### Phase 4 — Required AI

- AI Smart Search
- AI Requirement Generator

### Phase 5 — Operations

- calendar
- organization settings
- Admin transfer

### Phase 6 — Hardening

- Security Rules verification with the emulator test suite
- permission testing
- mobile QA
- deployment

Security Rules are authored together with each collection during Phases 2 through 5, not written
for the first time here. Demo seed data is created at the end of Phase 2 so later modules are
built against realistic records.

Do not begin P1 stretch features while any critical P0 flow is broken.
