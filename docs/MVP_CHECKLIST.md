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
- [ ] Create Organization
- [ ] Creator becomes Admin
- [ ] Join code generated
- [ ] Organization Created / code screen
- [ ] Join Organization by code
- [ ] Duplicate membership prevented
- [ ] New joiner becomes Unassigned
- [ ] Unassigned waiting state
- [ ] Organization switching

### Dashboard

- [ ] Dashboard loads active organization only
- [ ] Core summary cards use real data
- [ ] Upcoming events summary
- [ ] Active production summary
- [ ] Permission-aware quick actions

### Teams / Members / Permissions

- [ ] Create/edit teams
- [ ] Members list
- [ ] Unassigned Members section
- [ ] Member Detail
- [ ] Assign one or more teams
- [ ] Assign module permissions
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
- [ ] Organization scope enforced
- [ ] Team edit scope enforced

### AI Smart Search — REQUIRED AI FEATURE

- [ ] Natural-language input
- [ ] Structured filter output
- [ ] Runtime validation of AI output
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
- [ ] Repair history visible from Inventory Item Detail

### Productions

- [ ] Production List
- [ ] Create Production
- [ ] Production Detail
- [ ] Production status
- [ ] Add/Edit Production Requirement
- [ ] Link requirement to inventory item
- [ ] Required quantity
- [ ] Real available quantity
- [ ] Deterministic shortage calculation
- [ ] Responsible team
- [ ] Requirement notes/action type

### AI Requirement Generator — REQUIRED AI FEATURE

- [ ] Production description input/context
- [ ] Generate Requirements with AI
- [ ] Structured suggestion validation
- [ ] Suggested item name
- [ ] Suggested quantity
- [ ] Suggested category/team when useful
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

- [ ] Action List page
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
- [ ] Prevent accidental duplicate active action items

### Calendar

- [ ] Calendar view
- [ ] Create Event
- [ ] Edit Event
- [ ] Event title
- [ ] Date/time
- [ ] Event type
- [ ] All Teams visibility
- [ ] Specific Team visibility
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
- [ ] Transfer Admin
- [ ] Organization never has zero Admins

### Security

- [ ] Firestore Security Rules created
- [ ] User cannot read unrelated organization data
- [ ] User cannot write unrelated organization data
- [ ] View permission cannot write
- [ ] None permission cannot read module
- [ ] Admin can access organization data
- [ ] Unassigned user blocked
- [ ] Team editing scope tested
- [ ] Privileged Cloud Functions verify caller authorization

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

- Firestore Security Rules
- permission testing
- mobile QA
- demo seed data
- deployment

Do not begin P1 stretch features while any critical P0 flow is broken.
