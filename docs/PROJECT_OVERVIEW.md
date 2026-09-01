# Theater Inventory Tracker — Project Overview

For a reader who wants to understand what this is and why it exists, without reading any code.

## The problem

A high school theater department owns a surprising amount of equipment. Microphones, lighting
instruments, cable, costumes, props, power distribution, radios. It is expensive, it is shared, it
breaks, and it moves — out to a rehearsal room, into a repair shop, home with a student who
promised to fix it.

Most programs track this in a spreadsheet. That works until it does not:

- **One person owns the file.** They know that "MIC-04" is the one with the intermittent cable.
  Then they graduate, and that knowledge leaves with them.
- **Repairs are invisible.** A light goes out for service and the spreadsheet still counts it.
  The number is right and the reality is wrong.
- **Planning happens from memory.** Somebody plans a musical around eight wireless microphones
  because the sheet says eight. Two are in a box marked "does not work" and one has been in a
  drawer at somebody's house since February.
- **Nobody trusts the number.** So people check the shelf anyway, which means the spreadsheet is
  doing no work at all.

The failure is not that a spreadsheet cannot hold the data. It is that a spreadsheet has no idea
what any of it *means*. It cannot tell you that a requirement is short, because it does not know
what a requirement is.

## What the application does about it

It keeps the same information, but with the relationships between things actually modeled — so the
software can answer questions instead of just storing rows.

**The workflow it supports, end to end:**

```
Inventory  →  Maintenance  →  Production planning  →  Action  →  Calendar
```

1. **Inventory.** Record what the program owns. Things that are interchangeable — 200 feet of
   cable, 40 gel frames — are counted. Things where it matters *which one* — a specific
   microphone with its own repair history — become individually tracked units with their own QR
   label.

2. **Maintenance.** When something breaks, it goes out for repair as a record: what went, to whom,
   when it is due back, what it cost. The inventory count follows automatically, because the number
   available is calculated from the equipment's actual state rather than typed in by hand.

3. **Production planning.** A production lists what it needs. The application matches each
   requirement against real inventory and calculates the shortage from live availability. Nobody
   types the shortage; if a microphone is out for repair, the shortage changes on its own.

4. **Action.** Every genuine shortage becomes one action: buy it, rent it, build it, or repair
   something. Each carries an owner, a due date, and an optional cost estimate. The production's
   estimated cost is the sum.

5. **Calendar.** Rehearsals, build days, inspections, and deadlines, linkable to the production or
   the repair they belong to.

**And two things a spreadsheet cannot do at all:**

- **QR labels.** Print a label, stick it on the equipment, and scanning it with a phone opens the
  record — the exact unit for individually tracked gear, or the item itself for a bin of cable that
  has no units to label. Continuous modes let one person walk a storage room checking equipment in,
  out, or inspected without touching the screen between scans.

- **Plain-language questions.** "Which microphones have never been inspected?" is answered from the
  organization's real records, with the actual matching records shown alongside the answer.

## Who uses it

**Technical theater students** — the crew who physically handle equipment. They scan labels, check
things in and out, report damage, and see what their crew is responsible for.

**Faculty and directors** — the person accountable for the program. They administer the
organization: create teams, decide who can see and change what, and look at the dashboard to know
where things stand.

**Production staff** — a stage manager or designer planning a show. They build the requirement list
and watch shortages resolve as equipment is bought, rented, built, or repaired.

Access is organized around **organizations**. One account can belong to several — a student in two
programs, a teacher covering two schools — with a completely separate role, teams, and permissions
in each. Data from one organization never appears in another's queries or interface.

Inside an organization there are three roles:

- **Admin** — full access. Creates teams, assigns people, transfers administration.
- **Member** — belongs to at least one team and has been given specific module permissions. Sees
  the whole organization's inventory; can edit their own crew's records.
- **Unassigned** — joined with the organization code and is waiting to be assigned. Can see the
  member directory and fill in their own profile, and nothing else.

That last role matters more than it sounds. Joining is open to anyone with the code, so joining has
to grant nothing. An Admin decides what someone can do, and until they do, the answer is nothing.

## Why it matters

The real value is not that the data is in a database instead of a spreadsheet. It is that
**questions get answered from records instead of from someone's memory**, and that the answer stays
correct when the situation changes.

When a microphone goes out for repair, three things update at once: the available count drops, the
production that needed it shows a shortage, and the dashboard reflects it. Nobody had to remember
to do that. That is the difference between a document and a system.

It also means the program survives turnover. The student who knew everything still graduates — but
what they knew is now written down in a form the next person can actually use.

## What it is not

This is a **student portfolio project and a working MVP**, not commercial theater-management
software. It is built to be genuinely usable by a real program and to be fully explainable by the
student who built it — which are both deliberate constraints.

Intentionally out of scope, with reasons:

| Not built | Why |
|---|---|
| Equipment photos | Storage and moderation cost, little planning value over a good name and category |
| Checkout notifications / email | Requires server-side scheduling; the Firebase plan in use has no server code |
| Recurring calendar events | A recurrence engine is real complexity for a modest convenience |
| Trend analytics, forecasting, export | Beyond what the current dashboard charts answer |
| Multi-currency | Single-program, single-currency by design |
| Per-production reservation of specific units | Would need a booking model; shortage math answers the actual question |
| Public organization discovery | Organizations are joined by code on purpose |
| Native mobile app | The web application is responsive and the scanner uses the phone camera in the browser |
| Offline-first sync | Meaningful complexity; the tool is used where there is a network |
| Hard deletion of members, items, or teams | Deleting would strand history; records are deactivated instead |

Features that **were** built and are sometimes assumed to be future work: QR labels and printing
for both units and items, the camera scanner, serialized equipment with lifecycle history, the
member directory and profiles, dark mode, and the dashboard charts. All shipped.

## Further reading

| | |
|---|---|
| `USER_GUIDE.md` | How to actually use it |
| `ARCHITECTURE.md` | How it is built, and how quality was checked |
| `PERMISSIONS.md` | The full authorization contract |
| `DEMO_CHECKLIST.md` | Demonstrating it |
| `INTERVIEW_GUIDE.md` | Explaining it |
