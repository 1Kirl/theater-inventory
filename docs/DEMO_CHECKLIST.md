# Demo Checklist

Everything needed to demonstrate the application, and the story to tell while doing it.

**Production: https://theater-inventory.web.app**

---

## Demo data strategy

### What exists

**Ridgeview High School Theater** is a seeded demo organization built for exactly this purpose: six
teams, 17 inventory items across ten categories, four repair records including one overdue, a
musical with a genuine microphone shortage, two action items, and six upcoming calendar events.

Two accounts, deliberately different:

- an **Admin** who administers the organization
- a **Member** assigned to Sound and Lighting only, with inventory edit, maintenance view,
  productions edit, and calendar view

That difference is the point. It lets the permission model be demonstrated by signing in as two
people rather than by describing it.

Credentials live in the untracked `.env.seed.local`. They are not in this repository and are not in
any document here.

### The rule for demo day

**Demonstrate in the demo organization. Never in a real program's organization.**

If a school's actual inventory is in this application, that organization is not a demo environment.
Its data is somebody's real equipment records, and a demonstration should not be the reason any of
it changes.

### If the demo data needs rebuilding

```
cp .env.example .env.seed.local   # keep the DEMO_* block, fill it in
npm run seed:demo -- --confirm
```

The seed script creates; it never deletes. It refuses to run without `--confirm`, and refuses to run
twice against the same organization rather than duplicating everything. It runs through the ordinary
client SDK under the same Security Rules as any user — there is no privileged path and no Admin SDK.

**There is no reset feature and there will not be one.** The application has no "clear all data"
button, and no destructive reset script exists. That is deliberate: a one-click wipe is a permanent
hazard sitting next to real data, and it exists to solve a problem that a documented manual
checklist solves just as well.

To start genuinely fresh, create a new organization through the ordinary interface and seed into
that. Creating is cheap; deleting is the dangerous operation, so the strategy avoids needing it.

---

## Before the demo

**The environment**

- [ ] https://theater-inventory.web.app opens and loads
- [ ] Sign-in works with the demo Admin account
- [ ] Sign-in works with the demo Member account (test this beforehand, not in front of people)
- [ ] The demo organization is selected, and it is the **demo** organization
- [ ] Dashboard shows real numbers, not empty states
- [ ] The production with the microphone shortage still shows a shortage

**If demonstrating the scanner**

- [ ] A printed QR label is physically in hand
- [ ] The phone or laptop camera works and the browser has camera permission
- [ ] The scanner page opens and the camera preview appears
- [ ] Network is reachable from the phone, on the same connection you will use live

**If demonstrating AI**

- [ ] Try both features once, beforehand. The Gemini free tier allows a limited number of requests
      per day, and spending them in rehearsal means having none in the room.
- [ ] Have a fallback: the features degrade to an error message, and the manual search and manual
      requirement entry still work, so the demo can continue

**Presentation**

- [ ] Theme set to whatever suits the room — dark for a projector in a dark space, light otherwise
- [ ] Browser zoom at a size the back row can read
- [ ] No real personal contact information visible in Contacts
- [ ] No other organization's data visible anywhere
- [ ] Unrelated browser tabs closed

---

## The demo story — 5 to 8 minutes

Do not tour every button. Tell the story of one problem being solved.

**Open with the problem, in one sentence.** *"A school theater tracks thousands of dollars of
equipment in a spreadsheet that one person maintains, and when a show is planned around eight
microphones, nobody knows that two of them are broken."*

| # | Beat | Show | Say |
|---|---|---|---|
| 1 | **Sign in** | User ID and password | Not an email — students get an ID the program assigns |
| 2 | **Choose organization** | The selection screen | One account, several programs, a different role in each |
| 3 | **Dashboard** | Totals, charts, open repairs | Everything here is calculated, not typed |
| 4 | **An inventory item** | A bulk item — condition breakdown, availability | Interchangeable things get counted |
| 5 | **A serialized unit** | An individual microphone: status, condition, history | When it matters *which one*, each gets its own record |
| 6 | **QR** | Scan the printed label with a phone | The label opens the record — the exact unit, or the item for a bulk bin. No login prompt, no search |
| 7 | **Lifecycle** | Check the unit out, then in | Every transition is recorded with who and when |
| 8 | **Maintenance** | The overdue repair | The available count already reflects this. Nobody adjusted it |
| 9 | **Production requirements** | The musical, with its requirement list | What the show needs, matched against what we own |
| 10 | **The shortage** | The microphone requirement showing short | *This* is the number the spreadsheet could never produce |
| 11 | **The action** | Buy / rent / build / repair, with an estimate | One action per shortage, with an owner and a due date |
| 12 | **Cost** | The production cost panel | Summed in whole cents. Unpriced work is reported as unpriced, never as free |
| 13 | **Smart Search** | *"Which microphones have never been inspected?"* | The answer, plus the real records — the AI cannot invent one |
| 14 | **Draft Requirements** | Describe a show, get suggestions | Drafted against our actual inventory — and nothing saves until I approve it |
| 15 | **Permissions** | Sign in as the Member: fewer modules | Enforced in the database, not by hiding buttons |
| 16 | **Close** | Dark mode toggle, or the phone layout | Same application, in a dark booth or in a hand |

**Close on the point, not on a feature.** *"The real change is not that the data is in a database.
It is that when a microphone goes out for repair, the available count, the production shortage, and
the dashboard all update at once — and nobody had to remember to do that."*

### Trimming to five minutes

Drop beats 7, 12, and 16. Keep 6, 10, 13, and 15 — the QR scan, the live shortage, the grounded AI
answer, and the permission boundary. Those four are the ones people remember.

---

## During the demo — what not to do

Nothing here is fragile; these are about not breaking somebody's data or the rest of the demo.

- **Do not transfer administration.** It works, and undoing it needs the other account.
- **Do not deactivate a member.** Especially not the account you are signed in as.
- **Do not regenerate the join code** unless you are specifically demonstrating that. It
  immediately invalidates the old one.
- **Do not retire or delete equipment** you will need later in the demo. Retirement is permanent.
- **Do not demonstrate in a real program's organization.**
- **Do not show real contact details.** The demo profiles carry made-up phone numbers and emails
  for exactly this reason.
- **Do not open Organization Settings for anything but the permission beat**, and do not save
  anything there.

Safe to do freely: check equipment in and out, create and cancel a requirement or action, add a
calendar event, run both AI features, switch theme, switch organization.

---

## After the demo

- [ ] Remove any records created live — a demo requirement, a test action, a scratch calendar event
- [ ] Return any unit checked out during the demo to Available
- [ ] Confirm the demo organization still has its 17 items, its production, and its shortage
- [ ] Sign out, especially on a shared or projected machine
- [ ] If the Member account was used, leave it assigned as it was

If something was changed that cannot be undone by hand — a retirement, a regenerated code — note it
so the next demo is not surprised by it. Nothing here is destructive enough to need a rebuild, but
the next person should not have to rediscover it.

---

## If something goes wrong

Both AI beats were run against production while preparing this checklist and returned grounded
answers, so the wording above describes what they actually do rather than what they should.

**The AI feature errors.** Almost certainly the daily quota. Say so — it is an honest constraint of
the free tier — and continue with manual search or manual requirement entry. The rest of the
application is unaffected, which is itself worth pointing out: AI failure changes no data.

**The scanner will not open.** Camera permission, usually. Fall back to typing the equipment URL, or
simply open the unit from the inventory list. The QR is a convenience over a route that exists
anyway.

**A page shows "No access to this module".** You are signed in as the Member, not the Admin. That is
the permission model working; use it as the beat rather than fighting it.

**Nothing loads at all.** Check the network. The application has no offline mode and does not
pretend to.
