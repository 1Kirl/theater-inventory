# Theater Inventory Tracker — Claude Code Instructions

## 1. Project Goal

Build a responsive web application for high school theater departments to manage equipment inventory, maintenance and repair history, production requirements, action items, calendars, teams, members, and permissions.

The application must be polished enough to demonstrate a real operational use case while remaining understandable and explainable by a strong high school student.

Target completion date: **September 5, 2026**.

## 2. Required Tech Stack

Use the following stack unless the project owner explicitly approves a change:

- React
- Vite
- TypeScript
- React Router
- Tailwind CSS
- shadcn/ui
- Firebase Authentication
- Cloud Firestore
- Firebase Cloud Functions only for privileged operations that should not be trusted to the client
- Firebase Hosting
- Firebase AI Logic with Gemini for the two required AI features
- Git for version control

Approved additional dependencies:

- Zod — runtime validation of AI model output
- Vitest — unit tests for domain logic
- @firebase/rules-unit-testing with the Firebase Emulator Suite — Security Rules tests

Do not introduce a large state-management framework, SSR framework, SQL database, or additional backend platform unless there is a clear need and the project owner approves it.

## 3. Source of Truth

Before implementing any feature, read the relevant files in `/docs`.

Two kinds of authority apply, and they do not compete:

- `references/Theater_Inventory_Tracker_IA_v3.xlsm` is the current source for **what the product
  does** — pages, contents, components, and user-facing flows.
- `docs/DECISIONS.md` is the current source for **how it is built** — data shapes, permission
  model, and backend structure. Where the spreadsheet and the technical documents disagreed, the
  decisions in that file resolved the conflict, and `/docs` has been updated to match.

Priority order when documents appear to conflict:

1. `CLAUDE.md`
2. `docs/DECISIONS.md`
3. `docs/PROJECT_SPEC.md`
4. `docs/IA.md`
5. `docs/USER_FLOWS.md`
6. `docs/DATA_MODEL.md`
7. `docs/PERMISSIONS.md`
8. `docs/AI_SPEC.md`
9. `docs/DESIGN_SYSTEM.md`
10. `docs/MVP_CHECKLIST.md`
11. `references/Theater_Inventory_Tracker_IA_v3.xlsm`

The spreadsheet sits last only as a tie-breaker for implementation detail. For a question about
product behavior that `/docs` does not answer, it is the reference to consult.

If there is a conflict or ambiguity, do not silently choose a new product direction. Explain the issue and propose the smallest reasonable resolution.

## 4. Core Domain Rules

These rules must remain true throughout the application:

1. A user account is independent from an organization.
2. One user may belong to multiple organizations.
3. A user's role, teams, and permissions are different for each organization membership.
4. The user who creates an organization becomes its first Admin.
5. Users who join using an organization code initially become `unassigned` members.
6. Unassigned members must not receive normal inventory, maintenance, production, or administration access until an Admin assigns them.
7. Every organization-owned record must be scoped to an `organization_id`.
8. Data from one organization must never appear in another organization's queries or UI.
9. Admins have full access inside their organization.
10. The application must never allow an organization to end up with zero Admins.
11. Admin transfer must be explicit and safe.
12. Team membership and permissions are organization-specific.
13. A membership is a Member when it holds at least one team **and** at least one module
    permission at `view` or `edit`. This assignment condition is evaluated automatically on saving
    a membership and on completing a Transfer Admin; a membership that fails it is `unassigned`.
    Admin access ignores `team_ids` and `permissions`, but those fields are retained rather than
    cleared, because they are what the assignment condition reads after a transfer.
14. Memberships are deactivated, never deleted. The MVP has no hard delete for memberships,
    inventory items, or teams.
15. Derivable values are computed, not stored. Shortage quantity, condition summary, overdue
    state, and dashboard totals are always calculated from stored data.

## 5. Authentication Rule

The product UI uses **User ID + Password**, not social login.

For the MVP, use Firebase email/password authentication internally with an implementation-generated synthetic email derived from the immutable User ID.

Example concept:

`lighting01` -> `lighting01@theater-inventory.example.com`

The synthetic email must never be shown as the user's real email address.

Rules:

- User ID is unique.
- User ID is immutable in the MVP.
- Display name may be edited.
- Password may be changed.
- Password recovery by real email is out of scope for the MVP.

If a safer or simpler Firebase-compatible authentication design is proposed, explain it before changing this rule.

## 6. Firebase Architecture Rules

Use Firebase as the backend platform.

- Authentication: Firebase Authentication
- Persistent application data: Cloud Firestore
- Hosting: Firebase Hosting
- File uploads: not used in the MVP

Privileged organization operations run in callable Cloud Functions. There are exactly four:

- `createOrganization`
- `joinOrganizationByCode`
- `regenerateOrganizationCode`
- `transferAdmin`

These require the Blaze plan. Tell the project owner before the step that needs Firebase billing
configured; do not attempt to work around it silently.

The organization join code is never stored on the organization document. It lives in
`organization_join_codes` with the code as the document ID, and only an Admin can read it.

Keep Firebase access code outside page components. Use dedicated service/repository modules and typed interfaces.

Never put secrets or private API keys directly in the React source code.

## 7. Permission Rules

Do not rely on hidden buttons as security.

Permissions must be enforced in two places:

1. React UI/route guards for user experience.
2. Firestore Security Rules and/or trusted Cloud Functions for real authorization.

Permissions live inside `organization_memberships` as `team_ids[]` plus a `permissions` map.
There is no separate `team_permissions` collection.

The MVP has exactly four permission modules:

- `inventory`
- `maintenance`
- `productions`
- `calendar`

Dashboard has no permission of its own; each summary card follows the module it summarizes. The
Action List has no permission of its own; it follows `productions`.

Effective permission levels:

- `none`
- `view`
- `edit`

Team scope applies to `inventory_items`, `maintenance_records`, `production_requirements`, and
`action_items`. It does not apply to `productions`, `calendar_events`, or `teams`, which are
organization-level and need only the module permission.

Admin bypasses normal member permission checks inside the current organization and receives full organization access.

Unassigned members receive no normal module access unless explicitly stated in `PERMISSIONS.md`.

## 8. AI Rules

The application has exactly two required AI features for the MVP:

1. AI Smart Search
2. AI Requirement Generator

Read `docs/AI_SPEC.md` before implementing either feature.

Critical rules:

- AI must not invent inventory records.
- AI must never produce a Firestore document ID. It returns team names and inventory match
  keywords; application code resolves them against real organization data.
- AI must not directly edit Firestore production requirements.
- AI Requirement Generator produces suggestions only.
- A user must review and approve AI-generated requirements before saving them.
- Exact arithmetic such as shortage quantity must be calculated by application code, not by the model.
- All AI results must respect the active organization and the user's permissions.
- AI errors must fail safely and leave existing data unchanged.

## 9. UI and Responsive Rules

The app must work well on both desktop and mobile browsers.

Follow `docs/DESIGN_SYSTEM.md`.

General rules:

- Prefer simple, professional, theater-operations-oriented UI.
- Use shadcn/ui primitives before building custom primitives.
- Do not create decorative complexity that slows down the MVP.
- Tables may become cards on small screens.
- Forms must be usable on mobile.
- Loading, empty, error, and permission-denied states must be designed intentionally.
- Use semantic design tokens rather than random hard-coded colors.

## 10. TypeScript and Code Quality

- Use strict TypeScript.
- Avoid `any` unless there is a documented, unavoidable reason.
- Prefer small typed modules and reusable hooks/components.
- Keep domain logic out of visual components.
- Keep Firestore querying/mutation logic out of page components.
- Validate user input before writes.
- Use deterministic utility functions for calculations.
- Add comments only when they explain non-obvious reasoning.

## 11. Development Workflow

Do not build the entire application in one step.

Implement one bounded feature at a time.

For each feature:

1. Read the relevant documentation.
2. Summarize the intended behavior before large changes.
3. Implement the smallest complete version.
4. Test the feature manually and/or with automated tests when appropriate.
5. Run type checking.
6. Run lint.
7. Run the production build.
8. Fix errors before declaring the feature complete.
9. Summarize changed files and manual test steps.

Before changing the Firestore schema, permission model, routing hierarchy, or AI contract, explain the proposed change first.

## 12. Git Rules

Use small, feature-focused commits.

Examples:

- `chore: initialize react application`
- `feat: add authentication flow`
- `feat: add organization onboarding`
- `feat: implement inventory crud`
- `feat: add ai smart search`
- `feat: add production requirement generator`

Do not rewrite Git history unless explicitly requested.

## 13. Scope Control

Do not add features just because they are common in commercial inventory products.

MVP priorities are defined in `docs/MVP_CHECKLIST.md`.

Excluded from the MVP:

- QR scanning
- inventory photos
- checkout/check-in system
- advanced analytics
- cost forecasting
- notifications
- real-time chat
- social login
- recurring calendar events
- public organization discovery
- hard deletion of members, inventory items, or teams
- per-production inventory allocation or reservation

## 14. Completion Definition

A feature is not complete only because the UI renders.

A feature is complete when:

- its required user flow works,
- persistent data works where required,
- permission boundaries work,
- mobile layout is usable,
- loading/error/empty states are handled,
- typecheck/lint/build succeed,
- and the implementation still matches the project documentation.
