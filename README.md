# Theater Inventory Tracker

A web application for a high school theater department to keep track of what it owns, what is
broken, what a production needs, and what is happening this week.

**Live at https://theater-inventory.web.app**

## The problem

Equipment in a school theater is usually tracked in a spreadsheet that one person maintains and
nobody else trusts. Lights go out for repair and nobody records it. A musical is planned around
microphones that are already in a box marked "does not work". The person who knew where everything
was graduates in June.

This application keeps inventory, repairs, production requirements, and the calendar in one place,
scoped to an organization, so the answer to "do we have enough of these" comes from records rather
than memory.

## Who it is for

Technical theater students who handle the equipment, the faculty member or director who runs the
program, and production staff planning a show. One account can belong to several organizations —
a student in two programs, a teacher covering two schools — with a different role in each.

## What it does

**Inventory.** What the organization owns, where it is, its condition breakdown, and how much is
available. Two tracking modes: *bulk*, a counted quantity of interchangeable things, and
*serialized*, where every unit is its own record with its own history. A bulk item can be promoted
to serialized once it matters which one is which; the promotion is one-way.

**Equipment lifecycle.** A serialized unit is available, in use, in maintenance, lost, or retired.
Every transition is written to an append-only history with who did it and when.

**QR labels and scanning.** Two kinds of label, both printable. A *unit* label names one physical
piece and opens it directly. An *item* label names an inventory record — the answer for a bin of
cable, which has no units to label — and opens that record. Plus a camera scanner for phones.
Either label, scanned from an organization the browser does not currently have open, offers to
switch rather than refusing. Continuous scan modes: Inspect, Check out, Check in — which a unit
label supports and an item label does not, because a counted quantity has no unit to check out.

**Maintenance and repair.** What went out, to whom, when it is due back, and what it cost. Repairs
can be planned before they start, and a serialized repair names the exact units rather than a
count. The quantity currently in service is derived, never stored.

**Productions and requirements.** What a production needs, matched against real inventory, with the
shortage calculated from live availability by application code.

**Needs & Actions.** Buy, rent, build, or repair — one action per short requirement, with assignee, due
date, and an optional cost estimate. Production cost is summed from those estimates in whole cents.

**Calendar.** Rehearsals, build days, inspections, and deadlines, with optional links to a
production or a repair.

**Organizations, teams, members, permissions.** Teams and four module permissions are assigned per
membership, per organization. Contacts is an organization directory with a member-editable profile.

**AI Smart Search.** Ask a question about the inventory in plain language and get an answer plus the
real records it refers to.

**AI Draft Requirements.** Draft a production's equipment list against the inventory the
organization actually has. Suggestions only — a person reviews and approves before anything is
saved.

**Interface.** Responsive down to 375px, tables becoming cards on small screens. Light and dark
themes with a browser-local preference that defaults to light. Dashboard charts built from inline
SVG against the theme's own colour tokens.

## Technology

React · Vite · TypeScript (strict) · React Router · Tailwind CSS · shadcn/ui · Zod

Firebase Authentication · Cloud Firestore · Firebase App Check · Firebase AI Logic with the Gemini
Developer API (`gemini-3.5-flash`) · Firebase Hosting

Firebase **Spark plan only**. There are no Cloud Functions, no Admin SDK, and no server.

## Architecture in one page

A client-side single-page application talking directly to Firebase. Because there is no server,
**Firestore Security Rules are the authorization boundary** — not a second line of defence behind
server code. An invariant that is not expressed in the rules is not enforced anywhere.

- **Domain layer** (`src/domain/`) — pure functions. Availability, shortage, cost arithmetic,
  role computation, chart projections. No Firebase imports, unit-tested directly.
- **Services** (`src/services/`) — every Firestore read and write. Page components never query.
- **Features** (`src/features/`) — pages and the view helpers they use.
- **Routes** (`src/routes/`) — the route tree as data, with the guard chain asserted by a test.

Multi-document operations that would normally deserve a server — creating an organization, joining
by code, transferring administration — are client batches validated as a unit in the rules with
`getAfter()` and `existsAfter()`.

Derivable values are computed, never stored: shortage, condition summary, overdue state, dashboard
totals, and role. Money is integer cents; an unknown cost stays unknown rather than becoming zero.

`docs/ARCHITECTURE.md` has the longer version.

## Authorization model

Three roles, computed from two documents rather than stored:

- **Admin** — `organizations.admin_uid` names you. Full access to that organization, regardless of
  teams and permissions.
- **Member** — an active membership, **at least one team**, and at least one module at `view` or
  `edit`.
- **Unassigned** — an active membership that does not meet those conditions. May use Contacts and
  edit their own organization-local profile. No module access.

A stored permission is not an assignment. A membership that is active and carries `inventory: view`
with no team reads as Unassigned and is refused inventory by Security Rules — because removing
someone's last team is how an Admin withdraws access, and the permission map is deliberately left
behind as the record of what they had.

Once someone is an assigned Member, **module reads are organization-wide**. Team is an edit
ownership boundary, not a read filter: a stage manager has to see every crew's stock to plan
against it. `docs/PERMISSIONS.md` is the full contract.

## Authentication

The interface asks for a **User ID and password**, not an email address. The User ID is turned into
a synthetic email internally (`lighting01` becomes `lighting01@theater-inventory.example.com`)
purely so Firebase email/password authentication can be used. That address is never shown to the
user and is never treated as a way to contact anyone. User IDs are immutable; display names and
passwords can be changed. Password recovery by real email is out of scope.

## AI features

Both run in the browser through Firebase AI Logic on the Gemini Developer API. There is no Gemini
API key — the SDK reaches the service through the Firebase app, and **App Check is enforced**, so
it is a prerequisite rather than optional hardening.

The inventory the current user may already read **is** sent, so the model can answer questions
about what the organization actually has. It travels summarized and labelled with request-local
references (`I1`, `I2`); no Firestore document ID ever leaves the browser, and every reference the
model returns is checked against the ones that request supplied. Nothing about members, accounts,
or authentication is ever sent.

Every response is validated with Zod before it reaches application state, and unknown fields are
rejected rather than ignored. Exact arithmetic — shortage, cost totals — is application code, never
the model. Nothing the AI produces is written automatically: search results are real Firestore
records the application looked up itself, and generated requirements are review rows a person
accepts, edits, or removes.

`docs/AI_SPEC.md` is the specification; `docs/ARCHITECTURE.md` explains the grounding boundary.

## Prerequisites

- **Node.js 22 or newer** (Vite 8 and the seed script both require it)
- npm
- A Firebase project with Authentication (email/password), Cloud Firestore, and Firebase AI Logic
  enabled
- JDK 21 or newer, only to run the Security Rules tests against the emulator

## Local development

```
npm install
cp .env.example .env.local     # then fill in the values from the Firebase console
npm run dev
```

On localhost, App Check uses the SDK's debug provider. The first load prints a debug token to the
browser console; register it under **App Check → Manage debug tokens** in the Firebase console, or
the AI features will be rejected. Everything else works without it.

### Environment variables

`.env.local` — the Firebase web configuration. These are public by design and ship in the bundle.

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Optional:

```
VITE_FIREBASE_APP_CHECK_SITE_KEY   # required for a production build; reCAPTCHA Enterprise site key
VITE_APP_CHECK_DEBUG_TOKEN         # development only; pins an already-registered debug token
VITE_PUBLIC_APP_ORIGIN             # overrides the origin printed on QR labels
```

There is **no Gemini API key**. Firebase AI Logic reaches Gemini through the Firebase app itself.

A debug token is a secret and belongs only in the untracked `.env.local`. The site key and the
Firebase web configuration are not secrets. No secret value appears anywhere in this repository.

## Commands

```
npm run dev           # Vite dev server — note this talks to LIVE Firebase
npm run typecheck     # tsc, strict
npm run lint          # oxlint; the project's policy is zero warnings, not just zero errors
npm test              # domain logic and pure view helpers
npm run test:rules    # Security Rules against the Firestore emulator (needs JDK 21+)
npm run build         # production build
npm run seed:demo     # seed the demo organization (see below)
```

## Demo data

**Ridgeview High School Theater** is a seeded demo organization: six teams, 17 inventory items
across ten categories, four repair records including one overdue, a musical with a genuine
microphone shortage, two action items, and six upcoming calendar events.

It is created through the ordinary client SDK by two ordinary accounts, under the same Security
Rules as any user. There is no Admin SDK, no service account, and no privileged path: the
organization is created in the same batch shape the application uses, the Member joins with the
organization code and a join proof, and the Admin assigns teams and permissions afterwards.

```
cp .env.example .env.seed.local   # keep only the DEMO_* block, and fill it in
npm run seed:demo -- --confirm
```

`.env.seed.local` is gitignored and holds the two demo accounts' User IDs and passwords. **No demo
passwords are stored in this repository.** The seed refuses to run without the confirmation flag,
and refuses to run twice against the same organization rather than duplicating it. It creates; it
never deletes.

The dataset is plain data in `src/domain/demo-dataset.ts`, so its invariants — that the microphone
shortage is real, that every action refers to a matched and short requirement, that no repair sends
more units than exist — are unit-tested without touching Firebase.

The two demo accounts differ deliberately: the Admin administers the organization, and the Member
is assigned Sound and Lighting only, so the permission boundaries are visible without changing
anything.

## Deployment

Hosting and Firestore Rules are deployed **separately**, because they change for different reasons.

```
npm run build
npx firebase deploy --only hosting          # the client
npx firebase deploy --only firestore:rules  # the authorization boundary
```

`VITE_FIREBASE_APP_CHECK_SITE_KEY` must be set in `.env.local` before the build, because Vite
inlines it at build time. Without it, App Check enforcement rejects every AI request from the
deployed build while the rest of the application keeps working.

There are currently no composite Firestore indexes; `firestore.indexes.json` is intentionally
empty, because every query in the application is served by single-field indexes.

## Testing

| | |
|---|---|
| Domain and view-helper unit tests | 1948 |
| Security Rules tests against the emulator | 800 |
| Typecheck / lint / production build | clean |

Counts are a floor, not a quality measure. `docs/ARCHITECTURE.md` describes what the tests actually
cover, and lists real bugs that automated tests missed and manual QA caught — including one where
a wrong assumption was itself encoded in a passing test.

## Project status

Feature-complete MVP, deployed and in use for demonstration. All MVP phases are finished, along
with the post-MVP work: Contacts and member profiles, dark mode, the visual refresh and charts, the
integration QA and authorization alignment, QR labels for bulk items, and a light-theme refinement.

Every feature has been verified by hand, on localhost and against the deployed build: both AI
features with App Check enforced, the seeded demo data, both demo accounts, the deployed client,
and the deployed Security Rules. `docs/MVP_CHECKLIST.md` tracks it item by item.

## Known limitations

- A prototype and portfolio project, not enterprise theater-management software.
- No native mobile app. The web application is responsive and the scanner uses the phone camera in
  the browser, but there is nothing to install.
- No offline-first synchronization. A dropped connection means failed reads and writes, not a
  queue that syncs later.
- No password recovery by email, because accounts have no real email address.
- `maintenance_records.cost` is still a float in dollars, from the original maintenance
  implementation. Inventory and action-item costs are integer cents. Normalizing it is deliberately
  deferred — see technical debt in `docs/ARCHITECTURE.md`.
- No recurring calendar events; each occurrence is its own record.
- Analytics stop at the shipped dashboard charts. No trend history, no forecasting, no export.
- Demo data reset is a documented manual checklist, not one-click tooling. That is a deliberate
  safety choice, not a missing feature.
- AI answer quality depends on how much the organization has actually recorded. An empty inventory
  gives the model nothing to be grounded in.
- AI output always requires human review before it becomes data.

## Documentation

| | |
|---|---|
| `docs/PROJECT_OVERVIEW.md` | What the product is and why, for a non-technical reader |
| `docs/USER_GUIDE.md` | How to actually use the application |
| `docs/ARCHITECTURE.md` | Architecture, data model, security, and how quality was validated |
| `docs/DEMO_CHECKLIST.md` | Demo story and the checklist for demonstration day |
| `docs/INTERVIEW_GUIDE.md` | Explaining the project, including working with an AI coding agent |
| `docs/PERMISSIONS.md` | The authorization contract in full |
| `docs/DATA_MODEL.md` | Every collection, field, and constraint |
| `docs/AI_SPEC.md` | The AI contract |
| `docs/DESIGN_SYSTEM.md` | Visual and interaction rules |
| `docs/IA.md`, `docs/USER_FLOWS.md`, `docs/PROJECT_SPEC.md` | Product specification |
| `docs/MVP_CHECKLIST.md` | Scope tracking |
| `docs/DECISIONS.md` | What was decided and why, including decisions that supersede earlier ones |
| `CLAUDE.md` | Working rules for this repository |
