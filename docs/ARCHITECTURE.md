# Theater Inventory Tracker — Architecture

How the application is built, what the data looks like, how authorization works, and how any of it
was actually checked.

For the product itself, read `PROJECT_OVERVIEW.md`. For the full field-level data contract, read
`DATA_MODEL.md`. For the full authorization contract, read `PERMISSIONS.md`. This document is the
map between them.

---

## 1. Shape of the system

A client-side single-page application talking directly to Firebase. There is no server.

```
Browser (React SPA)
   │
   ├── Firebase Authentication ──── email/password, on a synthetic address
   ├── Cloud Firestore ──────────── all persistent data; Security Rules are the boundary
   ├── Firebase App Check ───────── attests requests come from this app
   └── Firebase AI Logic ────────── Gemini Developer API, gemini-3.5-flash
          
Firebase Hosting serves the built static bundle.
```

**Frontend:** React 19, Vite, TypeScript in strict mode, React Router, Tailwind CSS, shadcn/ui
primitives, Zod for runtime validation of anything the application did not itself produce.

**Backend:** Firebase Authentication, Cloud Firestore, Firebase Hosting, Firebase App Check.

**AI:** Firebase AI Logic on the Gemini Developer API. No Gemini API key exists — the SDK reaches
the service through the Firebase app.

Fourteen runtime dependencies in total. Nothing here is listed aspirationally: every one of these
is used.

### The constraint that shaped everything

The project runs on the **Firebase Spark plan**. No Cloud Functions, no Admin SDK, no Cloud Run.

That is not a minor deployment detail — it is the central architectural fact. It means:

- **Every write originates in the browser.** There is no trusted code path anywhere.
- **Firestore Security Rules are the authorization boundary**, not a second line of defence behind
  server validation. An invariant not expressed in the rules is not enforced anywhere.
- **Operations that would normally deserve a server** — creating an organization, joining by code,
  regenerating a code, transferring administration — are client batches. Because rules evaluate
  each write in a batch independently, those are validated as a unit with `getAfter()` and
  `existsAfter()`, so a half-formed multi-document operation is rejected rather than partly
  applied.

Working inside this constraint is most of what makes the project interesting.

---

## 2. How the code is organized

```
src/
  domain/      pure functions — no Firebase, no React
  services/    every Firestore read and write
  features/    pages, dialogs, and the view helpers they use
  components/  shared UI (shadcn primitives, charts, layout)
  routes/      the route tree as data, plus the guards
  types/       shared TypeScript types
  lib/         Firebase initialization, App Check, environment reading
```

Three rules hold this together:

**Domain logic is pure.** `src/domain/` imports no Firebase and no React. Availability, shortage,
cost arithmetic, role computation, chart geometry, theme resolution — all plain functions over
plain data. This is why the interesting logic can be unit-tested directly without mocking a
database, and it is where most of the test count lives.

**Page components never query Firestore.** Every read and write goes through `src/services/`, with
typed interfaces. A page that wanted to query directly would be a place where a permission check
could quietly diverge.

**Derivable values are computed, never stored.** Shortage quantity, condition summary, overdue
state, dashboard totals, effective role, available quantity for serialized items. Storing any of
these would create a second source of truth that drifts.

### The one deliberate exception

A serialized item stores **mirrors** of its units — `unit_counts`, `quantity_total`,
`quantity_available`, `condition_counts` — kept in step by transactions.

This breaks the rule above on purpose. Firestore rules cannot count documents, and the dashboard,
production shortage, and AI context would all need to read every unit of every item to answer
anything. The mirror lets those callers keep reading the same fields a bulk item has, without
learning that units exist. What the rules still enforce is that whatever is written **adds up**:
`quantity_available` must equal `unit_counts.available`, and the condition counts must total
`active_total`. The numbers cannot be internally contradictory even though rules cannot verify them
against the units themselves.

---

## 3. Data model

Fifteen collections, all top-level. Every organization-owned document carries `organization_id`, and
every rule takes it from the record itself rather than from anything the caller asserts.

| Collection | Holds | Scope |
|---|---|---|
| `users` | Account-level profile — display name | Account |
| `organizations` | Name, `admin_uid` | Organization |
| `organization_memberships` | `team_ids[]`, `permissions{}`, `is_active`, per-organization profile | Membership |
| `organization_join_codes` | Join codes, document ID **is** the code | Organization |
| `organization_admin_settings` | Pointer to the current join code | Admin only |
| `organization_membership_join_proofs` | Evidence a join used a live code | Membership |
| `teams` | Crews within an organization | Organization |
| `inventory_items` | Bulk quantities, or a serialized parent with mirrors | Team-owned |
| `inventory_units` | One physical unit: status, condition, location, pointers | Team-owned |
| `asset_events` | Append-only lifecycle history | Team-owned |
| `maintenance_records` | Repairs, with a team snapshot taken at filing | Team-owned |
| `productions` | A show | Organization |
| `production_requirements` | What a production needs | Team-owned |
| `action_items` | Buy / rent / build / repair — **document ID is the requirement ID** | Team-owned |
| `calendar_events` | Schedule | Organization |

### Relationships that matter

**Organization isolation.** Every organization-scoped rule reads `resource.data.organization_id`.
There is no query in the application that can span organizations, and no rule that would allow one.

**Team ownership.** Team-scoped records carry a required `team_id`. For maintenance it is a
*snapshot* taken when the repair was filed, not a live pointer to the item's current team — so the
crew that sent something for repair keeps control of that record even after the item changes hands.

**Serialized parent and units.** `inventory_units.inventory_item_id` points at the parent, and the
parent carries the mirrors described above. Promotion from bulk to serialized is one-way, enforced
in the rules: reversing it would strand the units and their history.

**One action per requirement.** `action_items` uses the requirement ID as its document ID. A second
action for the same requirement is not rejected by a check — it is structurally impossible.

**Nothing is hard-deleted.** No delete rule allows removing a membership, team, inventory item,
unit, maintenance record, production, or requirement. Calendar events are the one exception; they
carry no history that anything else points at.

---

## 4. Authorization

Full contract in `PERMISSIONS.md`. The summary:

### Role is computed, never stored

From two documents the caller can already read:

```
organizations/{id}.admin_uid == uid            → Admin
active membership
  AND team_ids.size() > 0
  AND at least one module at view or edit      → Member
otherwise                                      → Unassigned
```

There is no `role` field anywhere. Transferring administration writes one field, and both people's
roles change because the computation reads a different `admin_uid`.

### What each role gets

**Admin** — everything in that organization, regardless of teams and permissions. `admin_uid` is
the only input; a membership with no team and no permission is still an Admin's membership.

**Member** — the four modules at whatever level their permission map says.

**Unassigned** — Contacts and their own organization-local profile. Nothing else. Joining with a
code is open to anyone who has the code, so joining must grant nothing.

### The two axes

**Module permission** answers *which module, and may I write?* — `none`, `view`, `edit`, per module.

**Team** answers *which records may I change?* — and only that. Once someone is an assigned Member
with module `view`, **reads are organization-wide**. A stage manager cannot plan a show while
seeing only their own crew's stock.

### Permission alone is not an assignment

A membership can be active, carry `inventory: view`, and hold no team. That is not corruption —
it is what remains when an Admin removes somebody's last team, and the permission map is
deliberately left behind as the record of what they had.

Such a person is Unassigned, and Security Rules refuse them every module. This was not always true:
until the Extension D audit, the interface said Unassigned and the rules said reader, and the two
disagreed about the same person. The fix was one rules helper, `isAssignedMemberOf()`, now used by
the four module read helpers and the three organization-level edit helpers. Decision 98 records it
in full; the divergence was found and proven against the emulator rather than by reading.

### Guards are not the boundary

`src/routes/guards.tsx` decides what is rendered. Firestore Security Rules decide what may be read
or written. The two are tested separately, and the rules tests do not consult the interface at all.

Hiding a button is a user-experience decision. It is never a security measure.

---

## 5. AI integration

Two features, one contract.

**Smart Search** — a natural-language question over the current organization's inventory. Returns a
written answer plus real Firestore records the application looked up itself, and fills in the
ordinary filters, which remain editable.

**Draft Requirements** — a planning assistant for a production. Given a description, it drafts an
equipment list against the inventory the organization actually has, with notes on what is short.
Every suggestion is a review row; nothing is saved until a person approves it.

### The grounding boundary

| The model receives | The model never receives |
|---|---|
| Inventory the current user may already read | Any Firestore document ID |
| Summarized, labelled `I1`, `I2`, … | Anything about members or contacts |
| Category, condition, availability, stored cost | Account or authentication data |
| The user's question or description | Another organization's data |

Every reference the model returns is checked against the ones **that request** supplied. A
reference the application did not send resolves to nothing, so a hallucinated `I9` cannot become a
card on screen.

Every response is validated with Zod before it reaches application state, and **unknown fields are
rejected rather than ignored** — a model that starts returning a new field fails loudly instead of
having it silently dropped.

Exact arithmetic is never the model's job. Shortage and cost totals are computed by
`src/domain/`. The model is asked what equipment a show needs, never how much of it is missing.

**App Check is enforced** for Firebase AI Logic — reCAPTCHA Enterprise in production, the SDK debug
provider on localhost. It attests that a request came from this application. It is not
authorization: Security Rules remain the only thing deciding who may read what.

AI failure is safe by construction. Nothing is written as a side effect of a successful call, so a
failed call leaves the data exactly as it was.

### What was verified, and how far it goes

Both features were driven in a browser — on localhost and against the deployed build, with App Check
enforced — over real seeded data. That QA confirmed grounded record resolution for both inventory
items and equipment units across lifecycle, condition, availability, maintenance, and known-versus-
unknown cost; that a model reference the request did not supply produces no card; that generation
alone saves nothing and the model never wrote to Firestore; and that matching, shortage, and cost
remained application-owned.

It does not establish that the answers are always correct, that hallucination is impossible, or that
every prompt has been tried. The design assumes none of those: what it guarantees is that a wrong
answer cannot become data without a person approving it.

### The wire-schema incident

Worth recording because it is the kind of problem no amount of unit testing finds.

Structured Draft Requirements failed in live QA with HTTP 400, "Request contains an invalid
argument", on every request. The schema was valid JSON, the SDK's own TypeScript types accepted it,
and the failure was identical every time.

Bisecting the schema constraint by constraint isolated it to **`maxItems`**. Removing `maxItems`
(and `minItems`, the same keyword family) was the single change that made the request succeed. The
array bounds moved into application code, where they are enforced after validation.

The finding is deliberately stated narrowly. In **this project's runtime** — `@firebase/ai` 2.15.0,
`GoogleAIBackend`, `gemini-3.5-flash` — `maxItems` in the response schema produced HTTP 400. That is
an empirical observation about one configuration, not a claim that Gemini never supports `maxItems`.
`src/features/ai/wire-schema.test.ts` pins the schema against regression and says so in its own
comments.

---

## 6. Known technical debt

Material items only. This is not a bug list.

### `maintenance_records.cost` is a float in dollars

Everything else in the application stores money as **integer cents** — inventory unit cost, action
item estimates, production totals. Maintenance cost predates that decision and is still a number in
dollars.

**It works.** It is validated in the rules, it is displayed correctly, and it is not part of any
total that mixes it with cents. The debt is inconsistency, not incorrectness.

**Deliberately not migrated.** Normalizing it means a data migration on live records, on a plan
with no server to run one, for no behavioral gain. It is documented rather than done, and the right
moment is whenever maintenance cost first needs to be summed with anything else.

### Two vocabularies for "available"

Bulk items track `quantity_available` as a number. Serialized items derive availability from each
unit's status and condition, where a unit needing repair counts as available and an unusable one
does not.

These agree, and `src/domain/availability-consistency.test.ts` pins that they agree across all
twenty-five status/condition combinations — precisely because it would be easy for one of them to
drift during a future change.

### The inventory list is the only list on a card

The visual pass gave the inventory table a white card surface. Maintenance and the action list
still render their tables directly on the page ground. That was the scope of the change and it is
not a defect — but it is an inconsistency, and the honest place to record it is here rather than in
a claim that all list pages look alike. A future pass could give the other two the same treatment;
nothing depends on it.

### Test-count asymmetry

Rules tests are slow (a few minutes against the emulator) and require JDK 21. That makes them
easier to skip during rapid iteration than unit tests, which is exactly backwards from their
importance. Nothing enforces running them; the discipline is manual.

---

## 7. How quality was checked

### The layers

| Layer | What it covers |
|---|---|
| **Unit tests** (1948) | Domain logic and pure view helpers, with no Firebase |
| **Security Rules tests** (800) | Every rule, against the Firestore emulator |
| **Typecheck** | `tsc` strict, including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` |
| **Lint** | oxlint; policy is zero warnings, not just zero errors |
| **Production build** | The bundle that actually ships |
| **Manual QA on localhost** | Every feature, by hand, against live Firebase |
| **Manual QA in production** | The deployed build, after every release |
| **Real-device QA** | An actual phone, not a resized desktop browser |
| **Asset hash verification** | SHA-256 of each deployed asset against the audited local build |
| **Permission-boundary QA** | The Extension D integration audit |

### What the numbers are worth

They are a floor, not a measure. Every bug below passed the entire automated suite.

**A test encoded the wrong assumption.** The production cost panel treated "the known total is
$0.00" as "nothing has been costed" — and a passing test asserted that was correct, with a
paragraph of documentation explaining the reasoning. Both were wrong. A production whose only
action was a build costed at exactly $0.00 rendered "Estimated production cost / $0.00" directly
above "No known estimated action costs yet." The test did not catch it because the test was written
from the same misunderstanding as the code. Fixed by splitting one predicate into two: *has anybody
costed anything* is asked of the count, *is there a total to draw* is asked of the total.

**Rules and the interface drifted apart while both looked reasonable.** `effectiveRole()` required
a team; the rules did not. Each was defensible read on its own, and nothing tested the composition,
because the client tests took the role as an input rather than deriving it from a membership
document. The Extension D audit found it against the emulator; sixteen cases failed before the fix.

**A rule that was right for one caller was wrong for every other.** The calendar's comparator
ordered events by all-day, then time of day, then title — and never looked at the date. That is
correct *within* a day, which is why the one function that pre-filters to a single date was right
and hid it. Every caller that sorted across days was wrong: the dashboard put a 9am event three
weeks out above a 2pm event tomorrow, and because it shows only the first five, the wrong order
also decided which event vanished. Nothing was testing the composition; the tests covered the rule
in the context where it happened to be true.

**Three copies of the same object, all missing the same field.** A serialized item's cost vanished
the moment its first unit was created. Three services each kept their own hand-maintained
description of the parent record, all three omitted the cost field, and the write replaces the
whole document — so seven separate paths deleted it. The duplication was the defect; one shared
function was the fix, and the useful test is not "cost is present" but "nothing the parent owns is
missing".

**Fixing one thing made two things inconsistent.** Giving bulk items their own QR label was
correct, and it immediately created a second defect: the item route sat inside the organization
guards while the unit route did not, so the same scan behaved differently depending on which kind
of label it was. For a workflow where the person is holding a sticker and cannot tell the two
apart, that is worse than either behaviour on its own. Both now resolve through one function.

**Automated tests cannot see a phone.** Two defects survived the full suite and were found by
holding the app in a hand: a donut chart distorted because full-circumference strokes overlapped in
DOM order, and two navigation items highlighted simultaneously because `/inventory/scan` is nested
under `/inventory`. Both were fixed by removing the mechanism rather than tuning around it.

### Mutation testing

For anything security- or arithmetic-sensitive, a new test is not trusted until the code it guards
has been deliberately broken and the test has failed. Removing the team check from
`satisfiesAssignmentCondition` must fail nine tests; letting `hasModuleAccess` accept `unassigned`
must fail twenty-two. A test that passes both before and after a mutation is measuring nothing, and
this project has found real cases of exactly that.

---

## 8. Security and privacy

Bounded claims only. This is a student MVP, not audited software.

**Authentication.** The interface asks for a User ID and password. A synthetic email is derived from
the immutable User ID purely so Firebase email/password authentication can be used. That address is
internal: it is never displayed, never treated as a contact address, and never sent to the AI model.
Contact email is a separate, optional, per-organization profile field.

**Organization isolation.** Every organization-scoped rule takes `organization_id` from the record.
No query spans organizations and no rule permits it. Isolation is exercised directly in the rules
tests, not assumed.

**Authorization.** Rules are the boundary. The interface hides what you cannot use, but that is
presentation — every module read and write is independently enforced server-side, and route guards
are never the thing standing between someone and data.

**Team boundaries.** Editing a team-scoped record requires the record's team to be one of yours, on
both the team it has now and the team you are moving it to.

**Join codes.** The code is never stored on the organization document. It lives in a separate
collection keyed by the code itself. Any signed-in user may `get` a code they already hold; nobody
may list the collection, so codes and organizations cannot be enumerated. Regenerating invalidates
the previous code immediately.

**Both QR deep links carry no credential.** A printed label is the least controlled thing this
product produces — it is stuck to equipment that leaves the building and can be photographed by
anyone. There are two: `/equipment/{unitId}` for one physical piece and `/inventory/{itemId}` for
an inventory record. Neither URL grants anything. Rules gate the unit read on the unit's own `organization_id`, and
because Firestore denies a read of a document that does not exist, the client genuinely cannot
distinguish "this does not exist" from "this is not yours". The message says exactly that, which is
the only truthful thing to say and also stops a stranger confirming that a guessed ID is real.

**AI data boundary.** Inventory the user may already read is sent, labelled with request-local
references. No document ID, and nothing about members, contacts, accounts, or authentication ever
leaves the browser for the model.

**App Check** is enforced for AI Logic. Attestation, not authorization.

**Secrets.** No secret value is committed. `.env.local` and `.env.seed.local` are gitignored, and
`.env.example` carries variable names and explanations only. Demo account passwords exist only in
an untracked file. The Firebase web configuration and the App Check site key are public by design
and ship in the bundle; the App Check *debug token* is a secret and is documented as one.

**Development-only code does not ship.** App Check debug logging and AI failure diagnostics are
behind `import.meta.env.DEV`, which Vite resolves at build time. Verified empirically, not assumed:
`grep` over the built bundle finds none of those strings. The one match for
`FIREBASE_APPCHECK_DEBUG_TOKEN` is inside the vendored Firebase SDK chunk, which reads that global
by name — not application code. The diagnostics themselves are written to exclude prompts,
inventory data, tokens, configuration, and user information even when they do run.

**What is not claimed.** This has not been penetration-tested or independently audited. There is no
rate limiting beyond what Firebase provides, no intrusion detection, and no formal threat model.
The rules are tested thoroughly against the threats that were thought of.

---

## 9. Deployment

Two independent targets, deployed separately because they change for different reasons and carry
different risk.

```
npm run build
npx firebase deploy --only hosting          # the client bundle
npx firebase deploy --only firestore:rules  # the authorization boundary
```

A rules change is a security release and can ship without touching the client. A client change
cannot alter the authorization boundary. Keeping the deploys separate makes that true in practice
rather than only in principle — the Extension D release was rules-only, and the client deliberately
stayed on the previous build because nothing in it had changed at runtime.

`VITE_FIREBASE_APP_CHECK_SITE_KEY` must be present before `npm run build`, because Vite inlines it.
Without it, App Check enforcement rejects every AI request from the deployed build while everything
else keeps working.

`firestore.indexes.json` is intentionally empty. Every query in the application is served by
single-field indexes, and an index deploy has never been required.

Releases are verified by comparing the SHA-256 of each deployed asset against the audited local
build, so what production serves is known rather than assumed.
