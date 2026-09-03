# Theater Inventory Tracker — User Guide

How to use the application. Organized around what you are trying to do, not around how the software
is built.

**Live at https://theater-inventory.web.app**

---

## Getting started

### Creating an account

Sign up with a **User ID** and a password. Not an email address — a short identifier like
`lighting01` that your program agrees on.

Two things to know:

- **Your User ID cannot be changed later.** Choose something you will still want in two years.
- **There is no password reset by email**, because the account has no email address. If you forget
  your password, an Admin cannot recover it either. Write it down somewhere sensible.

Your **display name** is what other people see, and you can change it whenever you like.

### Getting into an organization

An account by itself owns nothing. Everything — inventory, productions, the calendar — belongs to
an organization.

**If your program already uses the app:** ask an Admin for the organization code and choose
**Join an organization**. Codes are 16 characters and are not guessable.

**If you are setting it up:** choose **Create an organization**. Whoever creates it becomes its
first Admin.

You can belong to several organizations. If you do, you pick one when you sign in and can switch at
any time from the organization control in the header. Your role, teams, and permissions are
separate in each one.

### After you join

You will be **Unassigned** until an Admin assigns you. This is normal and not an error. While
unassigned you can:

- open **Contacts** and see who else is in the organization
- fill in **your own profile** so people can reach you

You will not see Inventory, Maintenance, Productions, or Calendar yet. Ask your Admin to assign you
to a team and give you the permissions you need.

---

## Roles and permissions

### The three roles

**Admin.** One per organization. Full access to everything in it, plus Organization Settings:
teams, members, permissions, the join code, the organization name, and transferring administration.

**Member.** Belongs to at least one team and has been given at least one module permission.

**Unassigned.** An active membership that has not been fully set up yet. Contacts and own profile
only.

### What decides your access

Three things, all of which must be true for a Member:

1. Your membership is active.
2. You belong to **at least one team**.
3. You have the relevant module at `view` or `edit`.

Permission without a team grants nothing. If an Admin removes you from every team, you become
Unassigned even though your permissions are still recorded — and if they put you back on a team
later, those permissions come straight back.

### The four modules

| Module | `view` | `edit` |
|---|---|---|
| **Inventory** | See all inventory and equipment in the organization | Create and change items and units owned by *your* teams |
| **Maintenance** | See all repair records | Create and change repairs for *your* teams |
| **Productions** | See productions, requirements, and Needs & Actions | Create and change them; requirements and actions are limited to *your* teams |
| **Calendar** | See the whole schedule | Create and change any event |

**Reading is organization-wide; editing is team-limited.** You can see every crew's equipment,
because you cannot plan a show otherwise. You can only *change* your own crew's records.

Two modules are organization-level for editing as well: productions themselves and calendar events
carry no owning team, so `edit` on those lets you change any of them.

The **Dashboard** has no permission of its own — each card follows the module it summarizes, and is
absent rather than empty when you cannot see that module. The **Needs & Actions** follows Productions.

### For Admins: assigning someone

Organization Settings → Members → the member → **Assign**.

Give them at least one team and at least one module permission. Either alone is not enough to make
them a Member.

To withdraw access, remove their teams. Their permissions stay recorded, which is what makes
restoring access one click rather than a reconstruction.

Members are **deactivated, never deleted** — deleting would strand everything they created.

### Transferring administration

Organization Settings → **Transfer administration**. Pick an active member; they become Admin and
you become an ordinary member with whatever teams and permissions your membership carries.

An organization can never end up with no Admin. The current Admin cannot deactivate their own
membership, and the transfer is a single atomic operation.

---

## Inventory

### Two kinds of item

**Bulk** — a counted quantity of interchangeable things. 200 ft of XLR cable. 40 gel frames. You
care how many there are, not which ones.

**Serialized** — every physical unit is its own record with its own asset code, condition, status,
location, and history. Use this when it matters *which one*: a specific microphone with a repair
history, a lighting instrument you want to track individually.

Start with bulk. If it turns out you need individual tracking, use **Promote to serialized** on the
item and generate units for it. **This is one-way** — going back would strand the unit records and
their history, so the app does not offer it.

### Creating an item

Inventory → **New item**. You will need:

- **Name** and **category** (twelve categories: Lighting Instruments, Cables, Lighting Accessories,
  Sound Equipment, Microphones, Tools, Set-Building Materials, Platforms / Flats, Props, Costumes,
  Hardware, Miscellaneous Technical Equipment)
- **Team** — the crew that owns it. This decides who may edit it, so it is required.
- **Quantity** and **condition breakdown** for a bulk item
- **Location** — where it lives
- Optionally, an **estimated unit cost** for planning

For a serialized item, the quantities are calculated from its units, not typed.

### Condition

Five levels: **Excellent**, **Good**, **Fair**, **Needs Repair**, **Unusable**.

The important distinction: something that **needs repair** still counts as available — it works,
it just wants attention. Something **unusable** does not count as available, even though it is
sitting on the shelf. The dashboard shows those separately as "Unusable, on hand" so they are
visible rather than quietly missing.

### Equipment status (serialized units)

| Status | Meaning |
|---|---|
| **Available** | On the shelf and usable |
| **In Use** | Checked out to a team, optionally to a specific person |
| **In Maintenance** | Out for repair |
| **Lost** | Missing, still hoped for |
| **Retired** | Permanently out of service, with a reason |

From a unit page you can **Mark as In Use**, **Check In**, **Mark Lost**, **Mark as Found**, or
**Retire**, depending on where it is now. Retiring asks why: disposed, permanently lost, donated,
sold, or other.

Every transition is recorded with who did it and when. That history is on the unit page and cannot
be edited or deleted.

### Costs

Costs are stored in whole cents, so nothing is lost to rounding.

**An unrecorded cost stays unrecorded.** It is not treated as zero, and a cost genuinely recorded
as $0.00 — a donated item, a favour — is shown as $0.00 rather than as "unknown". Those are
different statements and the app keeps them different.

Inventory value is the sum of what has been costed, and it tells you how much has not been costed
rather than pretending the total is complete.

---

## QR labels and the scanner

### Two kinds of label

**Unit labels** name one physical piece. A serialized item's units each get their own, so scanning
one opens that exact microphone with its own condition and history.

**Item labels** name an inventory record. Two hundred feet of cable is one row and no amount of
labelling makes it two hundred identities — so a bulk item's label opens the item's page, where
the quantity, condition, location and cost live. Every item has one, serialized parents included;
on those it sits below the units, because a unit label is the more precise answer when you have
one.

An item label deliberately carries no quantity. Quantity is the fastest-changing fact about a bulk
item, and a sticker saying "20" on a hook holding six is worse than a sticker saying nothing.

### Printing labels

Open a serialized item → **Print labels**. You get a printable sheet of QR labels, one per unit,
carrying the asset code.

For an item label, open any item → **Print item label** on the *Item label* card. **Copy item
link** puts the same URL on your clipboard.

Labels print black on white whatever theme you are using. A dark-mode label would be unreadable to
a scanner, so the printed output ignores the theme entirely.

Stick them on the equipment. A label is printed once and lives for years, so the URL it carries
always points at the deployed application, even if you printed it from a development machine.

### Scanning one label

Point any phone camera at a label and open the link. A unit label takes you to that unit —
condition, status, who has it, its full history. An item label takes you to the item's page.

If the unit belongs to an organization your browser does not currently have open — you are in two
programs and this is the other one's gear — the app offers to switch rather than refusing you. If
you have no access to that equipment at all, you get a message that deliberately does not say
whether the unit exists, so a stranger with a scanner learns nothing.

### Continuous scanning

**Scan** in the sidebar — or **Scan equipment** on the inventory page — opens the camera scanner
for walking a storage room. Three modes:

- **Inspect** — record that you have looked at each unit. Changes nothing else.
- **Check out** — mark units In Use. Pick the team first, and optionally a person.
- **Check in** — mark units Available again.

(The scanner's *Check out* and *Check in* do the same thing as **Check In** on a unit's own page;
the wording differs because one is a mode you stay in and the other is a single action.)

Scan one after another without touching the screen. A running list shows what has been scanned and
what happened to each. Duplicate scans of the same unit are recognized rather than applied twice.

Scanning an **item** label here is recognised too, but it is not one of these three actions — a
bulk item has no unit to check out. The scanner says what it read and offers to open the item.

The scanner needs camera permission from your browser, and it works in the browser — there is
nothing to install.

---

## Maintenance

### Planning a repair

You can record a repair before it happens. A **planned** repair is attached to the equipment as an
intention — the unit stays where it is and stays available. It is a note that something is going to
go out, not a claim that it has.

### Sending equipment out

Create a maintenance record with:

- the **item** and, for serialized equipment, the **exact units** going out
- **what is wrong**
- who is repairing it — **service provider** name, phone, email
- when you expect it back, and how it is coming back (pickup, delivery, other)

Statuses: **Planned → Sent → In Service → Ready → Returned**, with **Cancelled** available if the
repair does not happen.

While equipment is out, the available count drops automatically. Nobody adjusts it by hand.

A record shows as **overdue** when the expected return date has passed and it has not come back.
That is calculated, not a flag somebody sets.

### Getting it back

Mark the record **Returned**. Serialized units go back to Available, and the repair stays in each
unit's history permanently.

### History

Every unit page lists its repairs: the one it is on now, the one it is planned for, and everything
it has been through. The item page shows the same for bulk items.

---

## Productions

### Creating a production

Productions → **New production**. A title and a status: planning, in progress, or complete.

### Requirements

A requirement is one thing the production needs: an item name, a quantity, and the team responsible.

When you name something the organization already owns, link the requirement to that inventory item.
The app then shows:

- how many are **required**
- how many are **available right now**
- the **shortage**, which is the difference

The shortage is calculated live. If a microphone goes out for repair tomorrow, the shortage grows
on its own. Nobody types it, and it is never stored.

### Actions

Every genuine shortage becomes one action, and there is **at most one action per requirement** —
enforced structurally, not by a check somebody can forget.

Four kinds:

- **Buy** — acquire it permanently
- **Rent** — borrow it for the run
- **Build** — make it
- **Repair** — fix something already owned

Each action carries a quantity, a status (To Do, In Progress, Done, Cancelled), optionally an
assignee, a due date, and an estimated cost per unit.

The **Needs & Actions** collects every action across every production in one place, so somebody
responsible for getting things done has one list rather than several.

### Production cost

The estimated cost is the sum of `quantity × estimated unit cost` for every action that has one,
excluding cancelled work.

The panel keeps two different questions apart: whether anything has been costed, and whether the
total is greater than zero. A production whose only action is a build costed at exactly $0.00 shows
$0.00 — not "nothing has been costed". Actions nobody has priced are reported as unpriced rather
than counted as free.

---

## Calendar

Each event has a title, a date, an event type, optional start and end times, and a visibility
setting: everyone, or specific teams. An event with no start time is all-day.

The event type is free text, so an organization can use its own vocabulary. The form suggests
Rehearsal, Build Day, Equipment Inspection, Repair Pickup/Return, and Production Deadline, and the
filter is built from the types your organization has actually used.

An event can link to a **production** or a **maintenance record**, so a "return the lights" deadline
points at the actual repair.

Team tags on an event are labels and filters. They are not a permission boundary — anyone with
Calendar `view` sees the whole schedule.

There are no recurring events. A weekly rehearsal is created as individual events.

---

## AI features

Two features, doing genuinely different jobs.

### Smart Search

On the Inventory page. Ask a question in ordinary language:

- "Which microphones have never been inspected?"
- "What lighting equipment is in poor condition?"
- "Do we have enough XLR cable for the musical?"

You get a written answer **and the real records it is talking about**. The records are looked up
from Firestore by the application itself — the model does not produce them and cannot invent one.
It also fills in the ordinary filters, which stay editable, so you can adjust the search by hand
afterwards.

Smart Search only appears if you have Inventory `view`, and only ever searches what you are already
allowed to read.

### Draft Requirements

On a production. Describe the show — "1940s radio play, six actors, one interior set" — and get a
suggested equipment list drafted **against the inventory your organization actually has**, with
notes about what is short and what is missing entirely.

**Nothing is saved until you approve it.** Suggestions arrive as review rows. Accept the ones that
make sense, edit quantities, delete the rest. Only what you approve becomes a requirement.

### What the AI can and cannot do

**It can:** read the inventory you are already allowed to read, answer questions about it, and draft
suggestions.

**It cannot:**

- invent an inventory record — every record shown was fetched by the application
- write anything to the database
- produce a document ID; it returns names and keywords, and the app resolves them against real data
- do the arithmetic — shortage and cost totals are application code, always
- invent a price; an unknown cost stays unknown
- see anything about members, contact details, accounts, or passwords, ever

If the AI fails, nothing changes. Existing data is untouched and you can retry or work manually.

**A practical limit:** answer quality depends on what your organization has actually recorded. If
conditions are blank and nothing has an inspection date, the model has nothing to be grounded in.
The AI is useful in proportion to how well the inventory is kept.

---

## Contacts and your profile

**Contacts** is the organization directory: who is here, which teams they are on, and how to reach
them. Available to everyone with an active membership, including people still waiting to be
assigned.

Your **profile** is per-organization. The same account can present differently in two programs —
different phone number, different role description — because it is stored on the membership rather
than on the account.

You control four things: display name, phone, contact email, and a short biography. All optional.
Fill in what you want other people in that organization to have.

The email you enter here is the one people should use. It is unrelated to the internal address the
system uses for sign-in, which is never shown to anyone.

---

## Organization Settings (Admin only)

- **Organization name** — rename it.
- **Teams** — create teams and edit their names and descriptions. Teams are never deleted, because
  inventory, repairs, and memberships point at them.
- **Members** — see everyone, assign teams and permissions, deactivate a membership.
- **Join code** — view the current code and regenerate it. Regenerating immediately invalidates the
  old one, which is how you close off a code that has been shared too widely.
- **Transfer administration** — hand the organization to another active member.

---

## Appearance

A **light/dark toggle** sits in the header.

- New here? You get **light**. Your system's dark-mode setting does not silently override the app.
- Your choice is remembered **in that browser**, on that device. It is not stored in your account
  and not shared between devices, and it is the same for every organization you belong to.
- Printed QR labels stay black on white in either theme, and the scanner camera view is never
  tinted.

The interface works down to 375px wide. On small screens, tables become cards.

---

## Limitations worth knowing

- **No password recovery.** No email address, no reset link. Not even an Admin can recover a
  forgotten password.
- **No offline mode.** Losing your connection means reads and writes fail, not that they queue up.
- **Nothing is hard-deleted.** Members, items, and teams are deactivated or retired, never removed,
  because deleting them would strand the history that points at them.
- **Promotion to serialized is one-way.**
- **No notifications.** Nothing emails or alerts you about an overdue repair or a due date; you see
  it when you look.
- **No recurring calendar events.**
- **Legacy maintenance costs.** Repair costs are stored in dollars while everything else uses whole
  cents. It works correctly; it is simply not yet unified.
- **AI needs data.** A sparse inventory produces sparse answers.
