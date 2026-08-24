# Theater Inventory Tracker

A web application for a high school theater department to keep track of what it owns, what is
broken, what a production needs, and what is happening this week.

Equipment in a school theater is usually tracked in a spreadsheet that one person maintains and
nobody else trusts. Lights go out for repair and nobody records it; a musical is planned around
microphones that are already in a box marked "does not work". This application keeps inventory,
repairs, production requirements, and the calendar in one place, scoped to an organization, so the
answer to "do we have enough of these" comes from records rather than memory.

## Features

- **Dashboard** — inventory totals, open repairs, equipment currently out for service, active
  productions, unresolved actions, and upcoming events. Each card follows the permission of the
  module it summarizes, and is absent rather than empty when that module is not viewable.
- **Inventory** — what the organization owns, where it is, its condition breakdown, and how much is
  available. Readable organization-wide; editable by the owning team.
- **Maintenance & Repair** — the history of what went out, to whom, when it is due back, and what it
  cost. The quantity currently in service is derived, never stored.
- **Productions & Requirements** — what a production needs, matched against real inventory, with the
  shortage calculated from live availability.
- **Action List** — buy, rent, build, or repair, one action per requirement, with assignee and due
  date.
- **Calendar** — rehearsals, build days, inspections, and deadlines, with optional links to a
  production or a repair.
- **Organizations, teams, members, permissions** — one account can belong to several organizations
  with a different role in each. Teams and four module permissions are assigned per membership.
- **AI Smart Search** — ask a question about the inventory in plain language and get an answer plus
  the real records it refers to.
- **AI Requirement Generator** — draft a production's equipment list against the inventory the
  organization actually has, for a person to review before anything is saved.

## Tech stack

React · Vite · TypeScript · Tailwind CSS · shadcn/ui · React Router · Zod

Firebase Authentication · Cloud Firestore · Firebase App Check · Firebase AI Logic with the Gemini
Developer API (`gemini-3.5-flash`) · Firebase Hosting

Firebase **Spark plan only**. There are no Cloud Functions, no Admin SDK, and no server: Firestore
Security Rules are the authorization boundary.

## Prerequisites

- **Node.js 22 or newer** (Vite 8 and the seed script both require it)
- npm
- A Firebase project with Authentication (email/password), Cloud Firestore, and Firebase AI Logic
  enabled
- JDK 21 or newer, only if you want to run the Security Rules tests against the emulator

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
```

There is **no Gemini API key**. Firebase AI Logic reaches Gemini through the Firebase app itself.

A debug token is a secret and belongs only in the untracked `.env.local`. The site key and the
Firebase web configuration are not secrets.

## Validation

```
npm run typecheck     # tsc, strict
npm run lint          # oxlint; the project's policy is zero warnings, not just zero errors
npm test              # unit tests for domain logic and pure view helpers
npm run test:rules    # Security Rules against the Firestore emulator (needs JDK 21+)
npm run build         # production build
```

## Architecture notes

**Authentication.** The interface asks for a **User ID and password**, not an email address. The
User ID is turned into a synthetic email internally (`lighting01` becomes
`lighting01@theater-inventory.example.com`) purely so Firebase email/password authentication can be
used. The synthetic address is never shown to the user. User IDs are immutable; display names and
passwords can be changed.

**Authorization.** Every write comes from the browser, so Firestore Security Rules are the
authorization boundary rather than a second line of defence behind server code. Multi-document
operations — creating an organization, joining by code, transferring administration — are client
batches validated as a unit with `getAfter()` and `existsAfter()`. Around 330 tests exercise the
rules against the emulator.

Role is computed, never stored. Permission decides which module and whether you may write; team
decides which records inside the team-scoped modules.

**App Check** is enforced for Firebase AI Logic: reCAPTCHA Enterprise in production, the SDK's debug
provider on localhost, chosen at build time. It attests that a request came from this app and is not
authorization — Security Rules remain the only thing that decides who may read or write what.

**AI.** Both features run in the browser through Firebase AI Logic on the Gemini Developer API. The
application sends the inventory the current user may already read, summarized and labelled with
request-local references (`I1`, `I2`); no Firestore document ID ever leaves the browser, and every
reference the model returns is checked against the ones that request supplied. Responses are
validated with Zod before any of it reaches application state.

Nothing the AI produces is written automatically. Search results are real Firestore records the
application looked up itself; generated requirements are review rows that a person accepts, edits,
or removes, and only what is approved is saved.

## QA and demo data

**Ridgeview High School Theater** is a seeded demo organization: six teams, 17 inventory items
across ten categories, four repair records including one overdue, a musical with a genuine
microphone shortage, two action items, and six upcoming calendar events. A reviewer can sign in and
use the real workflows immediately.

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
and refuses to run twice against the same organization rather than duplicating it.

The dataset is described as plain data in `src/domain/demo-dataset.ts`, so its invariants — that the
microphone shortage is real, that every action refers to a matched and short requirement, that no
repair sends more units than exist — are unit-tested without touching Firebase.

The two demo accounts differ deliberately. The Admin administers the organization; the Member is
assigned Sound and Lighting only, with inventory edit, maintenance view, productions edit, and
calendar view, so the permission boundaries are visible without changing anything.

Signed in as the Admin, the Dashboard reads: 17 inventory records, 3 active repairs, 5 units
currently in service, 1 active production, 2 unresolved actions, and 6 upcoming events.

## Deployment

**Live at https://theater-inventory.web.app**, on Firebase Hosting.

```
npm run build
npx firebase deploy --only hosting
```

`--only hosting` keeps the deploy scoped: Firestore Rules and indexes are published separately and
are not republished by a Hosting deploy.

`VITE_FIREBASE_APP_CHECK_SITE_KEY` must be set in `.env.local` before the build, because Vite inlines
it at build time. Without it, App Check enforcement rejects every AI request from the deployed build
while the rest of the application keeps working.

The deployed build was smoke-tested as both demo accounts: sign-in, every module, direct navigation
and refresh on client-side routes, the `/team` redirect, an unknown route falling through to the
application's own NotFound rather than a Hosting 404, sign-out, the Member's permission boundaries,
and the 375px layout.

## Known pending verification

- **AI quality QA in a real browser is still pending** for both AI features after the data-aware
  redesign. The implementation is committed and covered by unit tests with the model boundary
  stubbed, but the Gemini free tier allows 20 requests per day per model and that quota was spent
  during a separate investigation. The seeded data supports the questions those features should
  answer; the answers themselves have not been judged. This is the only outstanding verification.

Everything else, including the seeded demo data, both demo accounts, and the deployed production
build, has been verified in a browser.

`docs/MVP_CHECKLIST.md` marks these distinctly: an item verified in a browser, an item implemented
but awaiting that verification, and an item not done.

## Documentation

`/docs` holds the product and technical specifications. `docs/DECISIONS.md` records what was decided
and why, including the decisions that supersede earlier ones. `CLAUDE.md` holds the working rules
for this repository.
