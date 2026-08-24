# Theater Inventory Tracker — MVP Checklist

Target completion: **September 5, 2026**

This document defines what must be finished before optional stretch work begins.

**How to read the boxes**

- `[x]` — implemented, and verified in a real browser by the project owner.
- `[x] … — implemented, browser QA pending` — built and covered by automated tests, but nobody has
  driven it in a browser yet. Unit tests passing is not verification.
- `[ ]` — not done.

The Dashboard, the lazy-route refactor, the 375px responsive pass, and the seeded demo dataset have
all been verified in a browser, as both demo accounts.

Two things remain outstanding, and only two:

- **AI quality QA.** Both AI features are implemented and unit-tested with the model boundary
  stubbed, but nobody has judged the answers they give against the seeded data. Blocked on the
  Gemini free tier's 20 requests per day. The demo *data* for those questions exists; the *answers*
  have not been assessed.
- **Deployment.** Firebase Hosting has not been deployed, and the production App Check site key is
  not configured.

## P0 — Required for Final Demo

### Project Foundation

- [x] React + Vite + TypeScript project initializes correctly
- [x] React Router configured
- [x] Tailwind CSS configured
- [x] shadcn/ui configured
- [x] Firebase project connected
- [x] Firebase Emulator Suite runs locally
- [x] Vitest configured
- [x] Zod configured for AI output validation
- [x] @firebase/rules-unit-testing configured
- [x] firebase-tools installed as a project-local devDependency, never globally
- [x] JDK 21 or newer available for the Firestore emulator
- [x] Spark plan only — no Cloud Functions, Admin SDK, or Cloud Run anywhere in the project
- [x] App Check enforced for Firebase AI Logic — reCAPTCHA Enterprise in production, debug provider on localhost (supersedes the earlier decision to exclude it)
- [x] Environment/config handling documented
- [x] Git repository initialized
- [x] Production build succeeds

### Authentication

- [x] Sign Up with User ID + Password
- [x] Log In with User ID + Password
- [x] User profile created in Firestore
- [x] Duplicate User ID handled
- [x] Authentication errors shown cleanly
- [x] Sign Out
- [x] Change Password

### Organization Onboarding

- [x] Organization Selection page
- [x] Multiple organization memberships supported
- [x] Create Organization as a single client batched write of four documents
- [x] Join Organization as a single client batched write of membership plus join proof
- [x] Regenerate join code as a single client batched write
- [x] Transfer Admin as a client Firestore transaction
- [x] Creator becomes Admin via organizations.admin_uid
- [x] Join code generated with crypto.getRandomValues, 16 characters, no Math.random
- [x] Join code stored in organization_join_codes with the code as document ID
- [x] Join code never stored on the organization document
- [x] Current join code pointer readable only by the Admin
- [x] Effective role computed at runtime, never stored
- [x] Organization Created / code screen
- [x] Join Organization by code
- [x] Duplicate membership prevented
- [x] New joiner becomes Unassigned
- [x] Unassigned waiting state
- [x] Organization switching

### Dashboard

- [x] Dashboard loads active organization only
- [x] Core summary cards use real data
- [x] Each card hidden unless its underlying module is viewable
- [x] Upcoming events summary
- [x] Active production summary
- [x] Permission-aware quick actions

### Teams / Members / Permissions

- [x] Create/edit teams
- [x] Members list
- [x] Unassigned Members section
- [x] Member Detail
- [x] Assign one or more teams
- [x] Assign the four module permissions (inventory, maintenance, productions, calendar)
- [x] Effective role reads as Member once a team plus a module at View or Edit is saved
- [x] Effective role falls back to Unassigned when either condition stops holding
- [x] team_ids and permissions retained when a user becomes Admin
- [x] Members cannot edit their own membership
- [x] Deactivate membership with is_active = false
- [x] Current Admin's membership cannot be deactivated
- [x] Admin full-access behavior
- [x] Unassigned access restriction
- [x] UI route guards
- [x] Backend authorization rules

### Inventory

- [x] Inventory List
- [x] Desktop table
- [x] Mobile card list
- [x] Add Inventory Item
- [x] Edit Inventory Item
- [x] Inventory Item Detail
- [x] Category filter
- [x] Team filter
- [x] Location filter
- [x] Condition filter
- [x] Availability filter
- [x] Standard keyword search
- [x] Quantity validation
- [x] Condition-count validation
- [x] Condition summary derived, not stored, with an Unclassified remainder
- [x] Available quantity manually maintained and never auto-adjusted
- [x] Organization scope enforced
- [x] Team edit scope enforced — reading stays organization-wide
- [x] team_id required and validated against the organization's teams

### AI Smart Search — REQUIRED AI FEATURE

- [x] Natural-language input — implemented, browser QA pending
- [x] Structured filter output using team_name, never team_id — implemented, browser QA pending
- [x] Conditions returned as an array — implemented, browser QA pending
- [x] Runtime validation of AI output with Zod — implemented, browser QA pending
- [x] Display interpreted filters — implemented, browser QA pending
- [x] Query real Firestore inventory — implemented, browser QA pending
- [x] No fabricated inventory results — implemented, browser QA pending
- [x] Permission/org scope preserved — implemented, browser QA pending
- [x] Error/retry state — implemented, browser QA pending
- [x] Manual search remains available — implemented, browser QA pending
- [x] Result count and clear/reset action — implemented, browser QA pending
- [x] Interpreted filters land in the manual filter state and stay editable there — implemented, browser QA pending
- [x] An unresolvable team or category is reported, not guessed at — implemented, browser QA pending
- [x] Smart Search hidden from users without Inventory view — implemented, browser QA pending
- [x] AI answers from the accessible inventory, not only from the question — implemented, browser QA pending
- [x] Natural-language answer shown above the real records — implemented, browser QA pending
- [x] Temporary inventory refs validated; an unsupplied ref shows nothing — implemented, browser QA pending
- [x] Never-inspected, condition, and availability questions answered — implemented, browser QA pending

### Maintenance & Repair

- [x] Maintenance Overview
- [x] Repair status filters
- [x] Add Repair / Service Record
- [x] Edit Repair / Service Record
- [x] Issue description
- [x] Quantity sent
- [x] Sent date
- [x] Expected return date
- [x] Actual returned date
- [x] Pickup/delivery method
- [x] Service provider name
- [x] Service provider phone
- [x] Optional provider email
- [x] Optional cost
- [x] Repair notes
- [x] Overdue state
- [x] team_id copied from the inventory item on creation
- [x] Currently-in-service quantity derived and shown beside available quantity
- [x] Repair history visible from Inventory Item Detail

### Productions

- [x] Production List
- [x] Create Production
- [x] Production Detail
- [x] Production status
- [x] Add/Edit Production Requirement
- [x] Link requirement to inventory item
- [x] Required quantity
- [x] Real available quantity, derived not stored
- [x] Deterministic shortage calculation, derived not stored
- [x] Not Matched state for requirements with no linked inventory item
- [x] Responsible team
- [x] Requirement notes

### AI Requirement Generator — REQUIRED AI FEATURE

- [x] Production description input/context — implemented, browser QA pending
- [x] Generate Requirements with AI — implemented, browser QA pending
- [x] Structured suggestion validation with Zod — implemented, browser QA pending
- [x] Suggested item name — implemented, browser QA pending
- [x] Suggested quantity — implemented, browser QA pending
- [x] Suggested category and suggested_team_name when useful — implemented, browser QA pending
- [x] inventory_match_keyword returned instead of an inventory item ID — implemented, browser QA pending
- [x] Application resolves names and keywords to real IDs — implemented, browser QA pending
- [x] Inventory matching suggestions — implemented, browser QA pending
- [x] Accept suggestion — implemented, browser QA pending
- [x] Edit suggestion — implemented, browser QA pending
- [x] Remove suggestion — implemented, browser QA pending
- [x] Regenerate — implemented, browser QA pending
- [x] Save only approved suggestions — implemented, browser QA pending
- [x] No direct AI Firestore writes — implemented, browser QA pending
- [x] Shortages calculated after approval using real data — implemented, browser QA pending
- [x] Error/retry state — implemented, browser QA pending
- [x] Suggestions start unaccepted; generation alone saves nothing — implemented, browser QA pending
- [x] Suggested team name resolved deterministically against real teams — implemented, browser QA pending
- [x] A team the reviewer cannot write to blocks acceptance until they choose another — implemented, browser QA pending
- [x] Approved requirements saved with source = ai_approved — implemented, browser QA pending
- [x] Manual requirement entry still available when AI fails — implemented, browser QA pending
- [x] AI assessment shown above the review list — implemented, browser QA pending
- [x] Available and shortage shown as facts come from the app, not the model — implemented, browser QA pending
- [x] suggested_action stays transient and is never persisted — implemented, browser QA pending
- [x] General guidance mode when the user has no Inventory view — implemented, browser QA pending
- [x] Malformed individual suggestions dropped without losing the rest — implemented, browser QA pending

### Action List

- [x] Action List page, gated by the productions permission
- [x] Action item document ID equals requirement_id
- [x] Created or updated only when the user chooses an action type
- [x] Quantity defaults to the shortage and is never overwritten by later recalculation
- [x] Current shortage displayed separately from action item quantity
- [x] Never created for Not Matched, zero shortage, or Already Available
- [x] Link action to production requirement
- [x] Buy
- [x] Rent
- [x] Build
- [x] Repair
- [x] Quantity
- [x] Responsible team
- [x] Optional assignee
- [x] Optional due date
- [x] Status
- [x] Notes
- [x] Shortage dropping to zero marks the item done or cancelled instead of deleting it

### Calendar

- [x] Calendar view
- [x] Create Event
- [x] Edit Event
- [x] Delete Event, the only delete flow in the MVP
- [x] Event title
- [x] Date/time
- [x] Event type
- [x] All Teams visibility
- [x] Multiple specific teams via team_ids
- [x] Date with optional start and end time
- [x] Event with no times treated as all-day
- [x] Team visibility treated as a display filter, not a security boundary
- [x] Optional linked production
- [x] Optional linked repair record
- [x] Notes
- [x] Mobile usability

### Organization Settings

- [x] Edit organization name/description
- [x] View/copy current join code
- [x] Regenerate join code
- [x] Old code becomes invalid
- [x] Existing members remain unaffected
- [x] Current join code readable by Admin only
- [x] Regenerate restricted to Admin
- [x] Revoked codes retained with active false and revoked_at
- [x] Organization rename updates the active code snapshot in the same batch
- [x] Rename touching only organizations.name is rejected
- [x] Transfer Admin
- [x] New Admin keeps existing teams and permissions
- [x] Outgoing Admin resolved to Member or Unassigned by the assignment condition
- [x] No extra UI for configuring the outgoing Admin
- [x] Organization never has zero Admins

### Security

- [x] Firestore Security Rules created alongside each collection, not retrofitted
- [x] User cannot read unrelated organization data
- [x] User cannot write unrelated organization data
- [x] View permission cannot write
- [x] None permission cannot read module
- [x] Admin can access organization data
- [x] Unassigned user blocked
- [x] Deactivated membership blocked
- [x] Team editing scope tested on the four team-scoped collections
- [x] Organization-level collections editable without a team check
- [x] Join code get allowed to signed-in users, list denied to everyone
- [x] organization_admin_settings readable only by the Admin
- [x] Join proofs cannot be listed, updated, or deleted
- [x] Joining cannot self-grant teams or permissions
- [x] Membership create denied without a valid join proof in the same batch
- [x] Re-joining after deactivation is denied
- [x] Transfer Admin denied for non-Admins and for inactive targets
- [x] Current Admin's membership cannot be deactivated
- [x] Member directory query without is_active is rejected, not filtered
- [x] Directory query verified at 1, 5, 10, and 20 members
- [x] Initial creation path and existing-organization path tested separately
- [x] Rules covered by @firebase/rules-unit-testing against the emulator

### Responsive QA

- [x] Sign Up / Login usable on mobile
- [x] Organization Selection usable on mobile
- [x] Dashboard usable on mobile
- [x] Inventory usable on mobile
- [x] Repair form usable on mobile
- [x] Production Requirements usable on mobile
- [x] Calendar usable on mobile
- [x] Member management usable on mobile
- [x] No critical horizontal overflow around 375px

### Final Demo / Delivery

- [x] Seed/demo organization created
- [x] Demo Admin account prepared
- [x] Demo Member account prepared
- [x] Demo inventory populated
- [x] At least one repair history example
- [x] At least one production with shortages
- [x] At least one action item
- [x] Calendar events populated
- [x] AI Smart Search demo query prepared — data supports the four QA questions; answers not yet judged
- [x] AI Requirement Generator demo production prepared — 200-seat, 20-vocalist musical seeded; output not yet judged
- [ ] Firebase Hosting deployment works
- [x] README contains local run instructions
- [x] No TypeScript errors
- [x] Lint succeeds
- [x] Production build succeeds

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

### Phase 2A — Organization Foundation, No Interface

- correct the stale comment in `src/lib/env.ts`, which still says access control lives in
  "Security Rules and Cloud Functions"
- domain types
- organization services: create, join, assign, transfer, regenerate, rename
- Security Rules for organizations, memberships, join codes, admin settings, and join proofs
- Firestore indexes if the queries require any
- @firebase/rules-unit-testing suite
- transaction and batch validation
- directory query tested at 1, 5, 10, and 20 members

### Phase 2B — Organization Interface

- organization selection
- create / join screens
- unassigned state
- Admin organization management

Phase 2B does not begin until the Phase 2A rules tests pass. If a query and its rule turn out to be
incompatible, stop and report rather than relaxing the rule or dropping a required filter.

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
