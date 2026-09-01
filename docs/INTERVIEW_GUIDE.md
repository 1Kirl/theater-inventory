# Interview Guide

Preparation for explaining this project out loud.

**Use this to understand the answers, not to memorize them.** Every question below has a real answer
grounded in something that actually happened while building this. An interviewer can tell the
difference between someone who knows their project and someone reciting a page — and the follow-up
question is where that shows. If you understand *why* each decision was made, you can answer a
question this document never anticipated.

Where an answer says *"I decided"* or *"I found"*, that should be true. Where it is not, say so —
"the agent generated that and I reviewed it" is a perfectly good answer, and a more impressive one
than a claim that does not survive a follow-up.

---

## 1. The 30-second introduction

> I built a web application for high school theater programs to manage their equipment. They own
> tens of thousands of dollars of lights, microphones, and cable, and most track it in a spreadsheet
> that one person maintains. My application connects inventory to repairs and to production planning,
> so when a microphone goes out for service, the production that needed it immediately shows a
> shortage. It is a React and TypeScript app on Firebase, live in production, with two AI features
> built on Gemini.

Stop there. Let them ask.

## 2. The one-minute version

Add the three things that make it more than a database:

> The interesting part is that it has no server. It runs on Firebase's free tier, which means no
> Cloud Functions — every write comes from the browser, so **Firestore Security Rules are the only
> authorization boundary**. That shaped the whole design and it is where most of my testing went:
> 800 rules tests against the emulator.
>
> Second, equipment can be tracked two ways — counted in bulk when the units are interchangeable, or
> individually when it matters which one, with its own QR label and lifecycle history.
>
> Third, the AI is deliberately constrained. It can read the inventory to answer questions, but it
> can never write a record, never produce a document ID, and never do arithmetic. Shortage and cost
> are application code. The AI suggests; a person approves.

---

## 3. What problem did you identify?

Start concrete, not abstract.

> A school theater's equipment lives in a spreadsheet one person maintains. It works until it
> doesn't. Repairs are invisible — a light goes out for service and the sheet still counts it, so
> the number is right and the reality is wrong. Planning happens from memory: somebody plans a
> musical around eight microphones because the sheet says eight, and two are in a box marked "does
> not work". And the person who knew that graduates in June.
>
> The failure isn't that a spreadsheet can't hold the data. It's that a spreadsheet doesn't know
> what any of it *means* — it can't tell you a requirement is short, because it doesn't know what a
> requirement is.

## 4. Why this solution?

> I modeled the relationships instead of just the rows. A requirement points at an inventory item;
> availability is derived from equipment state; a repair changes that state. Once those connections
> exist, the shortage is a calculation rather than something someone maintains.
>
> That principle runs through the whole thing: **anything derivable is computed, never stored.**
> Shortage, condition summary, overdue state, dashboard totals, even a user's role. Storing any of
> those creates a second source of truth that eventually disagrees with the first.

## 5. How did you design the information architecture?

> I started from workflow rather than from data. The real sequence in a theater program is
> inventory → maintenance → production planning → action → calendar, so the navigation follows it.
>
> I wrote it out as a specification before building: pages, what each contains, and what a user does
> on each. That's in `docs/IA.md` and `docs/USER_FLOWS.md`, and I kept them as the source of truth
> for *what the product does* while a separate decisions log became the source of truth for *how
> it's built*. When those two disagreed, I resolved it explicitly and wrote down which won.

## 6. How did you build the MVP?

> One bounded feature at a time, in phases. Each one: read the spec, implement the smallest complete
> version, test it, run typecheck and lint and the build, fix what broke, then stop and verify
> before starting the next.
>
> Stopping was the part that mattered. It's tempting to keep going while things are working, and
> every time I did that I ended up with a larger change than I could actually check.

## 7. Why React, TypeScript, and Firebase?

> **React** because the interface is mostly stateful lists and forms, and it's what I could get
> productive in fastest.
>
> **TypeScript in strict mode** because the domain has real invariants. `exactOptionalPropertyTypes`
> caught actual bugs for me — in this codebase a field that is *absent* and a field set to
> `undefined` mean different things to Firestore, and the compiler enforced that distinction where I
> would have forgotten it.
>
> **Firebase** because I needed authentication, a database, and hosting without running a server,
> and its Security Rules let me put real authorization in the one place that can't be bypassed. The
> tradeoff is that rules are a strange constrained language and complex invariants are genuinely
> hard to express in them.

Good follow-up to be ready for — *"what would you use instead at scale?"*

> If I needed server-side scheduling — overdue notifications, for instance — I'd need Cloud
> Functions, which means the Blaze plan. That was an explicit constraint on this project, not an
> oversight, and it's why notifications aren't in scope.

## 8. How does authentication work?

> Users sign in with a **User ID and password**, not an email, because students don't reliably have
> school email and the program assigns identifiers anyway.
>
> Firebase Authentication only does email/password, so internally the app derives a synthetic address
> from the immutable User ID — `lighting01` becomes `lighting01@theater-inventory.example.com`. That
> address is never shown, never used as a contact address, and never sent to the AI model. Contact
> email is a separate optional profile field.
>
> The tradeoff I accepted: **no password recovery.** No real email means no reset link. I documented
> it rather than pretending otherwise.

## 9. How do organizations, teams, and permissions work?

The single most likely deep-dive. Know it properly.

> An account is independent of any organization, and can belong to several with a different role in
> each — a student in two programs, a teacher at two schools.
>
> **Role is computed, never stored.** The organization record names one person as its administrator;
> if that's you, you're Admin. Otherwise you're a Member when your membership is active, you're on at
> least one team, *and* you've been given at least one module. Failing that, you're Unassigned.
>
> There is no role field anywhere, and that's the part I'd point at. Handing the organization to
> somebody else writes exactly one value — who the administrator is — and both people's roles change
> at once, because the answer was never stored in the first place. Nothing has to be kept in sync,
> because there is only one copy of the fact.
>
> Permissions are four modules — inventory, maintenance, productions, calendar — each at none, view,
> or edit. Teams are a second, separate axis. **Permission answers which module and whether I can
> write; team answers which records I can change.**
>
> The subtle part: **reads are organization-wide, edits are team-scoped.** A stage manager has to see
> lighting and costume stock to plan a show, so restricting reads to your own team would break the
> product. What team scope protects is authorship — one crew can't quietly change another's records.

**Be ready for: "why does an unassigned user get nothing?"**

> Because joining is open to anyone with the code. If joining granted access, the code would *be*
> the access control. So joining grants nothing and an Admin decides.

## 10. Bulk versus serialized inventory

> Two tracking modes, because a theater genuinely has both kinds of thing. 200 feet of cable is
> **bulk** — a counted quantity of interchangeable units. A specific wireless microphone is
> **serialized** — it has its own asset code, condition, location, and repair history, because it
> matters which one.
>
> A bulk item can be promoted to serialized, and that's **one-way**. Reversing it would strand the
> unit records and their history, so the rules refuse it. A fresh item is the honest alternative.
>
> The design problem was that everything downstream — dashboard, shortage, AI context — needs
> "how many are available", and for serialized items that means counting units. Firestore rules
> can't count documents, and reading every unit of every item to render a dashboard would be absurd.
> So a serialized parent stores **mirrors** of its units, kept in step by transactions.
>
> That deliberately breaks my own "never store what you can derive" rule, and I can defend it: the
> rules can't verify the mirror against the units, but they *do* enforce that whatever's written adds
> up — available must equal the unit count's available, condition counts must total the active total.
> The numbers can't be internally contradictory.

## 11. How does the equipment lifecycle work?

> A serialized unit is available, in use, in maintenance, lost, or retired. Every transition writes
> an **append-only** event with who did it and when — that collection has no update rule and no
> delete rule.
>
> Availability has a deliberate subtlety. A unit that **needs repair** still counts as available —
> it works, it wants attention. A unit that's **unusable** doesn't, even though it's physically on
> the shelf. The dashboard shows those separately as "Unusable, on hand" rather than letting them
> vanish from the totals.

## 12. How does maintenance integrate with inventory?

> A repair record moves equipment out of availability. Nobody adjusts a count — the count is derived
> from what state the equipment is in.
>
> Two things I'd point out. First, repairs can be **planned** before they start: a plan is an
> intention attached to a unit, and the unit stays available, because a plan isn't a repair. Second,
> the team on a maintenance record is a **snapshot** taken when it was filed, not a live pointer to
> the item's current team — so the crew that sent something for repair keeps control of that record
> even after the item changes hands.
>
> This is also where I hit a real bug. A unit write replaces the whole document rather than merging,
> and the lifecycle service built its own object. Marking a unit as in use silently unlinked it from
> its maintenance plan and erased its repair history. The rules caught one field and I saw a
> permission error; **nothing would have caught the other one.** Now every unit write goes through a
> shared builder that carries every field through explicitly.

## 13. How does production matching work?

> A requirement names something the show needs and links to an inventory item. The application then
> computes: required, versus available right now, and the difference is the shortage.
>
> **The matching is deterministic and the arithmetic is application code.** The AI is never involved
> in either. If a microphone goes out for repair tomorrow, the shortage changes on its own, because
> nothing about it was stored.
>
> Each shortage becomes at most one action — buy, rent, build, or repair. That's enforced
> structurally: the action document's ID *is* the requirement's ID, so a second one is impossible
> rather than merely rejected.

## 14. How do cost calculations work?

> Money is **integer cents** everywhere it was designed, so nothing is lost to floating point.
>
> The important part is semantic: **unknown is not zero.** An item nobody has priced is unknown. An
> item genuinely priced at $0.00 — donated, a favour — is a known zero. Those are different
> statements and the app keeps them different everywhere: inventory value reports how much *hasn't*
> been costed rather than implying the total is complete.
>
> I got this wrong once, and it's my favourite bug in the project — question 18 has it.

## 15. Smart Search versus Draft Requirements

> Different jobs.
>
> **Smart Search** is a natural-language query over the inventory. It returns an answer plus the real
> records — which the *application* fetches from Firestore. The model interprets the question; it
> doesn't produce the results.
>
> **Draft Requirements** is a planning assistant. Describe a show, get a suggested equipment list
> drafted against the inventory you actually have. Every suggestion is a review row and nothing is
> saved until a person approves it.
>
> One reads, the other proposes. Neither writes.

## 16. How do you stop the AI hallucinating?

Strong question. Have the layers ready.

> Several layers, and none of them is "prompt it nicely".
>
> **It can't return an ID.** The model gets inventory labelled with request-local references — `I1`,
> `I2` — never Firestore document IDs. Every reference it returns is checked against the ones *that
> request* sent. A hallucinated `I9` resolves to nothing, so it can't become a card on screen.
>
> **It can't do arithmetic.** Shortage and cost totals are pure functions in the domain layer. I ask
> the model what equipment a show needs, never how much is missing.
>
> **Everything is validated with Zod**, and **unknown fields are rejected rather than ignored** — if
> the model starts returning a new field, that fails loudly instead of being silently dropped.
>
> **It can't write.** No AI path writes to Firestore. Search results are records the app looked up;
> suggestions are rows a person accepts or deletes.
>
> **It only sees what you can see.** The context is built from records the current user is already
> authorized to read, and nothing about members, contacts, or accounts is ever sent.
>
> So the worst case for a hallucination is that the model says something unhelpful. It can't create
> a record, invent a price that gets saved, or show equipment that doesn't exist.

## 17. What was difficult?

Pick two and go deep. Depth beats a list.

**Security Rules.** 

> They're a very restricted language — no loops, no variables, only a few document reads per request
> — and they're the *only* thing standing between the browser and the database. Anything I couldn't
> express there wasn't enforced anywhere at all.
>
> The hardest part was operations that write several documents at once. Creating an organization
> writes the organization, the first membership, and the first join code together, and it has to be
> all-or-nothing. But the rules check each write on its own, so "is this membership valid?" can't be
> answered by looking at that membership alone — it depends on an organization that doesn't exist
> yet. Firestore has a way to ask what the database *will* look like once the whole batch lands, and
> that's what the checks use.

*Optional detail if they push:* the functions are `getAfter()` and `existsAfter()`.

**Keeping the interface and the rules in agreement.**

> They're written in different languages, they're tested separately, and they can drift while each
> one looks perfectly reasonable on its own. That's question 18's second bug, and it's the one I'd
> most want to talk about.

## 18. Examples of bugs you found

Have three. They demonstrate different kinds of thinking.

**A test that encoded the wrong assumption.**

> The production cost panel treated "the known total is $0.00" as "nothing has been costed" — and I
> had written a passing test asserting that was correct, plus a paragraph of documentation
> explaining the reasoning. All three were wrong, from the same misunderstanding.
>
> A production whose only action was a build costed at exactly $0.00 rendered "Estimated production
> cost / $0.00" directly above "No known estimated action costs yet. Add an estimate…". It told the
> reader no estimate existed, underneath the estimate.
>
> The fix was splitting one predicate into two: *has anybody costed anything* asks the count, *is
> there a total to draw* asks the total. What I take from it is that **a test written from the same
> misunderstanding as the code confirms the misunderstanding.** Coverage can't catch that.

**The interface and the database disagreeing about the same person.**

> When an Admin removes somebody's last team, their permissions stay recorded — that's deliberate,
> it's the record of what they had. My client code called that person Unassigned. My Security Rules
> called them a reader, because every read helper checked "is the membership active and does it have
> the permission" and none of them checked for a team.
>
> Both looked correct in isolation. Nothing tested the composition, because my client tests took the
> role as an *input* rather than deriving it from a membership document.
>
> I found it by auditing rules against interface behavior in the emulator instead of reading, and
> sixteen cases failed before the fix. Five of them were writes I'd initially reported as already
> safe — team-scoped writes were fine, but three organization-level ones weren't, and I only found
> that because I checked the claim instead of restating it.

**Two defects that only exist on a phone.**

> A donut chart looked distorted on mobile. The cause was drawing each segment as a full-circumference
> stroke with offsets, so segments overlapped in DOM order and the last one lapped the first. And two
> navigation items highlighted at once, because `/inventory/scan` is nested under `/inventory` and
> React Router's prefix matching lit both.
>
> Both passed every automated test. I fixed each by removing the mechanism rather than tuning it —
> real arc paths instead of overlapping strokes, and one resolver for the whole nav bar whose
> single-value answer makes two active items structurally impossible.

**A rule that was right everywhere it was tested, and wrong everywhere else.**

> The dashboard's list of upcoming events came out in the wrong order and one event was missing
> entirely. The function that sorted them ordered by whether an event was all-day, then by time of
> day, then by title — and never looked at the date at all.
>
> What makes it interesting is *why nobody caught it*. That rule is correct when you're sorting
> events within a single day, and the one place it was tested did exactly that: it filtered to one
> date first, so the missing comparison never mattered. Every other caller sorted across days and
> was silently wrong — a 9am event three weeks away came out above a 2pm event tomorrow. And since
> the dashboard shows only the first five, the wrong order also decided which event disappeared.
>
> I'd say the lesson is that testing a function in the context where it happens to be correct tells
> you nothing about the contexts where it isn't. I wrote the fix, then deliberately broke it again
> to confirm my new test actually failed — and it reproduced the user's exact reported ordering.

**Three copies of the same thing, all missing the same field.**

> A serialized item's estimated cost disappeared the moment somebody added the first unit to it.
>
> The cause was duplication. Three different parts of the app each kept their own hand-written
> description of "here's what the parent item looks like", and all three had forgotten the cost.
> Because those writes replace the whole record rather than updating one field, the cost was
> deleted — from seven different places, not just the one the user noticed.
>
> The fix was to delete two copies and share one. What I took from it is that the bug wasn't the
> missing field, it was the three copies — and that a test asserting "the cost is still there" is
> weaker than one asserting "nothing the record owns has gone missing", because only the second one
> catches the next field somebody forgets.

**The AI schema incompatibility** — question 19.

## 19. The AI schema bug

Worth telling well. It's the best debugging story in the project.

> Draft Requirements failed with **HTTP 400, "Request contains an invalid argument"** on every
> single request, once I moved it to a structured response schema. The schema was valid JSON. The
> SDK's own TypeScript types accepted it. The error was identical every time and said nothing
> useful.
>
> I bisected the schema — removing one constraint at a time and retrying. Removing **`maxItems`** was
> the single change that made the request succeed. `minItems` is the same keyword family, so I
> removed both, and moved the array bounds into application code where they're enforced after
> validation.
>
> The wording matters to me: this is **an empirical finding about one runtime**, not a general claim.
> In this project's configuration — `@firebase/ai` 2.15.0, `GoogleAIBackend`, `gemini-3.5-flash` —
> `maxItems` in the response schema produced a 400. I don't know whether that's the SDK, the
> transport, or the backend, and I didn't have a way to find out. Saying "Gemini doesn't support
> `maxItems`" would be a bigger claim than my evidence supports.
>
> I wrote a test that pins the wire schema against regression, and the test's own comments say
> exactly what the finding is and isn't.

That last paragraph is the impressive part. Being precise about the limits of your evidence is a
senior engineering habit.

---

## Working with an AI coding agent

Questions 20–23 are likely to be the most interesting part of the conversation, because the honest
answer is more useful than a defensive one. **Do not oversell the agent, and do not oversell
yourself.**

## 20. What did you learn from vibe coding?

> That it moves the work rather than removing it. I spent much less time typing and much more time
> deciding what should be true and checking whether it was.
>
> The biggest shift: **I had to get much better at specifying.** A vague request produces plausible
> code that solves a slightly different problem, and that's harder to notice than code that doesn't
> compile. Writing the spec first — the IA, the data model, the permission contract — wasn't
> bureaucracy. It was what made the generated code checkable.

## 21. Advantages

> - **Speed on things I understand but don't want to type.** Forms, list pages, table-to-card
>   responsive layouts.
> - **Unfamiliar APIs.** I had never written Firestore Security Rules. Having a working starting
>   point to read, question, and correct was faster than the documentation alone.
> - **Tests I'd have skipped.** 800 rules tests and 1948 unit tests is more than I would have written
>   by hand, and the coverage is real.
> - **Exploring alternatives cheaply.** I could see two approaches implemented before choosing.
> - **Documentation as I went** rather than reconstructed afterwards.

## 22. Risks and disadvantages

Be specific. Generic answers here are unconvincing; you have real examples.

> - **Generated code can be plausible and semantically wrong.** The $0.00 bug wasn't a crash. It was
>   working code implementing a subtly wrong idea about what "no cost" means.
> - **Tests can encode the wrong assumption too.** That's the same bug's sting. The test agreed with
>   the code because both came from the same misunderstanding, so the suite passing proved nothing.
> - **Confident-sounding output.** I was told writes were already safe in the permission audit. Most
>   were. Three weren't, and I only found that because I checked the claim against the emulator
>   instead of accepting it.
> - **Two correct-looking pieces can be wrong together.** The role computation and the Security Rules
>   each read fine. Nothing had tested them as a pair.
> - **Code can outgrow your understanding.** If I'd accepted whole features without reading them, I
>   couldn't answer question 9 — and being unable to explain your own project is a real failure, not
>   a cosmetic one.
> - **Automated tests can't see a phone.** The donut and the navigation bugs passed everything and
>   were obvious in my hand.
> - **Fixing one thing can quietly break the consistency of another.** Adding QR labels for bulk
>   items was correct, and it immediately made the two kinds of label behave differently across
>   organizations — which for somebody holding a sticker they can't tell apart is worse than either
>   behaviour alone. Generated code is good at the change you asked for and blind to what the change
>   implies.
> - **Runtime incompatibilities still need human debugging.** No amount of prompting found
>   `maxItems`. Bisecting did.

## 23. What human judgment was still required?

The most important answer here. Be concrete.

> **Deciding what the product should do.** Whether reads are organization-wide or team-scoped isn't
> a technical question — it's a product decision about whether a stage manager can plan a show. I
> made that call and it shaped the entire permission model.
>
> **Resolving contradictions between my own documents.** My spreadsheet and my technical docs
> disagreed more than once. Something has to decide, and it can't be the thing that wrote both.
>
> **Deciding what's out of scope, and holding that line.** Photos, notifications, recurring events,
> analytics. Each is a defensible feature and each was a no, with a reason.
>
> **Testing on real devices.** Two bugs existed only in my hand.
>
> **Judging AI output quality**, which required knowing what a correct answer looks like.
>
> **Refusing to weaken a rule to make a test pass.** That comes up, and it's always the wrong fix.
>
> **Deciding when "it renders" isn't "it's done."** My completion bar was: the flow works, data
> persists, permission boundaries hold, mobile is usable, states are handled, typecheck and lint and
> build are clean, and the implementation still matches the documentation.

If asked to summarize:

> The agent was very good at *how*. I was responsible for *what* and *whether* — and *whether* is
> where the bugs were.

---

## 24. How did you test it?

> Layered, because different layers catch different things.
>
> **Unit tests (1948)** on the domain layer — pure functions, no Firebase, so the actual logic is
> testable directly. **Rules tests (800)** against the Firestore emulator, which is where
> authorization is verified, because that's where authorization *lives*. Strict typecheck, lint at
> zero warnings, and the production build. Then manual QA on localhost, manual QA against the
> deployed build, and QA on a real phone.
>
> For anything security- or arithmetic-sensitive I used **mutation testing**: deliberately break the
> code and confirm the test fails. Removing the team check from the role computation has to fail
> nine tests. If a test passes both before and after a mutation, it's measuring nothing — and I found
> real cases of exactly that.
>
> I'd also say the test counts are a floor, not a measure. Every bug I described in question 18
> passed the entire suite.

## 25. What would you improve next?

> **Normalize maintenance cost to integer cents.** It's a float in dollars from the original
> implementation, while everything else is cents. It works and it's isolated, but it's inconsistent,
> and I documented it as debt rather than doing a live data migration for no behavioral gain.
>
> **Notifications for overdue repairs and due dates** — the most requested thing a real program would
> want. It needs server-side scheduling, so it needs Cloud Functions and the paid plan.
>
> **Offline support**, because a storage room is exactly where the signal is worst.
>
> **More real-device testing earlier.** Both mobile bugs would have been caught in minutes if I'd
> been checking on a phone throughout instead of at the end.

## 26. Could a real theater program use this?

Be honest. Confident and bounded is stronger than a sales pitch.

> Yes, for its core job — and I'd want to be clear about what it doesn't do.
>
> It handles inventory, repairs, production planning, and the calendar for a real program's real
> equipment. The permission model is genuinely enforced, not cosmetic. The demo organization is
> seeded with realistic data and the workflows hold up.
>
> What a program would miss: notifications, offline access, and password recovery. And there's no
> data migration path in — somebody would be typing the first inventory in by hand.
>
> So: usable by one program that decides to adopt it, not a product I'd ship to a hundred schools
> without more work on operations and support.

---

## Questions to have thought about

Not scripted — just don't be surprised.

- *"What would you do differently starting over?"* — Real-device testing from the beginning, and
  writing the permission contract as executable tests on both sides before implementing either.
- *"What's the weakest part?"* — The mirror fields on serialized items. It's a deliberate,
  defensible exception, but it's the one place a bug could produce silently wrong numbers.
- *"How do you know it's secure?"* — Bounded answer. It isn't audited or penetration-tested. What I
  can say is that authorization is enforced where it can't be bypassed, and that it's tested against
  the threats I thought of.
- *"What if the AI is down?"* — Every AI feature degrades to an error message and the manual path
  still works. AI failure changes no data, by construction.
- *"How long did this take?"* — Answer honestly, including that an agent wrote much of the code and
  you specified, reviewed, tested, and corrected it.
- *"Show me something you're proud of."* — Have one ready. The one-action-per-requirement design,
  where the document ID makes a duplicate structurally impossible rather than merely rejected, is a
  good small one.
