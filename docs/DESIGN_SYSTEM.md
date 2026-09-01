# Theater Inventory Tracker — Design System

## 1. Design Goal

The product should feel like a clean internal operations tool for a theater department.

It should be:

- professional,
- easy to scan,
- calm rather than decorative,
- usable by students and teachers,
- responsive on phones,
- visually consistent across modules.

Do not design it like an entertainment landing page or consumer social app.

## 2. UI Foundation

Use:

- Tailwind CSS
- shadcn/ui
- semantic CSS variables / design tokens

Prefer shadcn/ui components for:

- Button
- Card
- Dialog
- AlertDialog
- Input
- Textarea
- Select
- DropdownMenu
- Tabs
- Badge
- Table
- Sheet / Drawer
- Tooltip
- Calendar / date picker where appropriate
- Form primitives

Do not add a second UI component library.

## 3a. Theme (Light and Dark)

The application ships two themes, light and dark, and nothing else.

Rules:

- **Light is the product default.** A browser that has never chosen sees light.
- **The operating system preference is not consulted.** `prefers-color-scheme` is
  deliberately unused. Department machines are shared and are often left on
  whatever the previous person set, so the OS is not evidence of what this user
  wants. Dark is a choice made in the application.
- **The choice is remembered in the browser**, under `theater-inventory.theme`,
  holding exactly `light` or `dark`. A missing key, an unrecognised value, or
  storage that is unavailable all resolve to light.
- **The choice is not stored in Firestore.** It is not per organization, per
  team, or per account, and it is not synchronised between devices. Signing out,
  signing back in, and switching organization all leave it untouched.
- **Dark is applied as a `dark` class on the root element**, matching the
  `@custom-variant dark (&:is(.dark *))` the stylesheet declares. The root also
  carries `color-scheme`, which is the only thing native controls — date and
  time pickers, number spinners, scrollbars, autofill — read.
- **A small inline script in `index.html` sets both before the first paint**, so
  a returning dark-mode user never sees a light frame. It mirrors
  `src/domain/theme.ts` and a test asserts the two still agree.

Components follow the theme by using semantic tokens. Two exceptions are
deliberate and must not be tokenized:

- **Printable equipment labels** are black on white with an explicit white QR
  quiet zone, whatever the application looks like. Ink is not a screen, and a
  dark label does not scan.
- **The camera preview** in the scanner is never tinted, filtered, or
  blended.

## 3b. Visual Identity — Pastel Green

The identity is a restrained pastel green family, carried through semantic
tokens rather than applied to components directly.

- **Sage** — primary identity and active accents
- **Soft mint** — light surfaces, selected states, highlights
- **Muted eucalyptus** — secondary accent and supporting information

Rules:

- **Colour is used selectively.** The page ground is a pale sage-gray and cards
  are white, far enough apart that a card reads as raised without a heavy
  shadow. It was near-white once, six thousandths of lightness from the cards,
  and the whole interface read as one flat sheet. The ground still reads as
  neutral: the hue is there to be recognised, not noticed. The eye needs
  neutral places to rest, and a uniformly pale-green interface reads as a tint
  applied by accident.
- **Light and dark are one design system, not two.** Every colour token defined
  under `:root` has a counterpart under `.dark`, and a test in
  `tests/unit/theme-boundaries.test.ts` fails if one is added without the other.
- **Dark is not an inversion.** Pastels brightened on a dark ground glow. The
  dark palette is deep charcoal carrying the same green hue at low chroma, with
  accents desaturated rather than lightened.
- Values are OKLCH, matching the existing token system.

## 3c. Status and Condition Colour

Every state in the application resolves to a **tone** — a meaning, not a shade —
defined once in `src/domain/status-tone.ts`. Each tone is a single CSS token per
theme; the soft badge fill and border are that colour at low opacity.

| Tone | Used for |
| --- | --- |
| `positive` | Available · Returned · Done · Completed · Excellent |
| `ready` | Ready for Pickup · Good |
| `info` | In Use · Sent · To do · Active production |
| `planned` | Planned · Planning |
| `warning` | In Maintenance · In Service · In Progress · Fair |
| `caution` | Needs Repair · Unusable but on hand |
| `danger` | Lost · Unusable · Overdue |
| `neutral` | Retired · Cancelled · Unclassified |

Rules:

- **Never colour alone.** Every badge shows its label. Tone is a second channel.
- **Lifecycle and condition are different questions** and are drawn as different
  objects: a lifecycle state is a filled pill, a condition is a dotted chip. A
  unit can be available *and* unusable, and the interface has to be able to say
  so without looking self-contradictory.
- **One vocabulary.** Features must not define their own tone types. Four
  separate ones existed before this and all of them collapsed into the same two
  or three greys.

## 3d. Charts

Charts are used where they answer an operational question, and nowhere else.

Principles:

- **A chart never computes anything.** Every figure comes from an existing
  domain helper — `activeQuantityOf`, `summarizeProductionCosts`, an item's own
  unit counts. Projections live in `src/domain/chart-projections.ts` and are
  tested. A chart that disagreed with the card above it would be worse than no
  chart.
- **Colour travels as a CSS custom property**, never as a resolved value, so a
  wedge follows the theme the way a badge does and dark mode needs no second
  palette in JavaScript.
- **The numbers are the content.** Every chart is accompanied by its figures as
  real text — a legend or a value beside each bar — and the drawing itself is
  labelled for assistive technology. Nothing is communicated by colour alone.
- **Empty is not zero.** A chart with no data shows an empty state explaining
  why, not an empty ring or a row of zero-length bars.
- **No decorative charts.** A graph that restates a single number already on the
  page is removed, not kept.

The MVP has three:

| Chart | Question | Metric |
| --- | --- | --- |
| Dashboard — Equipment status | What state is our individually tracked equipment in? | Serialized items' `unit_counts`, six buckets |
| Dashboard — Inventory by category | What is the inventory made of? | `activeQuantityOf` summed by category |
| Production Detail — Estimated cost | What is this production's budget made of? | `summarizeProductionCosts().byType` |

**Equipment status has six slices, not five.** Available, *unusable on hand*, in
use, in maintenance, lost, retired. The middle one is not optional: a unit
sitting on the shelf in unusable condition is active and present but is
deliberately not counted as available, and it is the term that makes
`active_total` add up. Omitting it would either overstate Available or leave a
wedge unaccounted for.

**Inventory by category is counted in physical things**, using the same measure
for both tracking modes: a maintained quantity for a bulk item, `active_total`
for a serialized one. Retired equipment is excluded from both. The item count
travels as secondary text rather than as the bar length, because "forty cables"
and "forty kinds of cable" are different claims.

**Unknown cost stays unknown, and a known zero stays known.** An action with no
estimate is counted and reported separately, never folded into a total and never
drawn as a wedge. An explicit $0.00 estimate is different information: it stays
in the known total, and the panel must never describe it as missing.

Those are two questions, not one, and the panel answers both:

- **Is there a total to draw?** Bars need length. Against a zero total they
  would claim the work was costed and found to be free in four separate
  categories, so they are not drawn.
- **Has anybody costed anything?** Asked of the count of estimated actions, not
  of the total. Work estimated at exactly $0.00 is an answer somebody gave, and
  the panel reports it as one.

## 3. Visual Style

Use a neutral professional base with one restrained accent color through semantic tokens.

Do not hard-code many unrelated colors into components.

Recommended semantic roles:

- background
- foreground
- card
- muted
- border
- primary
- destructive
- warning
- success

Status colors may be used consistently for:

- Good / success
- Needs Repair / warning
- Unusable / destructive
- Planning / neutral
- Active / primary
- Completed / muted

Accessibility and readability are more important than dramatic visual styling.

## 4. Typography

Use the default high-quality sans-serif stack provided by the application/shadcn setup unless a different font is explicitly approved.

Hierarchy:

- Page title: strong, clear
- Section heading: medium emphasis
- Card title: concise
- Body: readable at mobile sizes
- Metadata: smaller and muted

Avoid excessively small text.

## 5. Layout

### Desktop

Recommended structure:

- left sidebar navigation,
- top header,
- organization switcher in header/sidebar,
- page content area with max readable width where appropriate.

Sidebar modules:

- Dashboard
- Inventory
- Maintenance
- Productions
- Action List
- Calendar
- Team & Members (Admin)
- Organization Settings (Admin)

Navigation items must respect permissions. Dashboard is always present for an assigned member
because it has no permission of its own. Action List appears whenever Productions is viewable.

### Mobile

Use a compact header plus either:

- bottom navigation for the most common modules, and a More menu,
- or a hamburger Sheet for full navigation.

Do not force the full desktop sidebar onto narrow screens.

Forms should use one-column layouts on mobile.

## 6. Responsive Data Presentation

### Desktop tables

Use tables when comparison/scanning benefits from columns.

Examples:

- Inventory List
- Maintenance Overview
- Production Requirements
- Action List
- Member list

### Mobile

Convert complex tables into stacked cards when necessary.

Each mobile card should show only the most important fields first and expose secondary details cleanly.

Do not require horizontal scrolling for critical workflows unless unavoidable.

## 7. Page Structure Pattern

Most operational pages should follow:

1. Page header
2. Short supporting description if needed
3. Primary CTA
4. Search/filter controls when applicable
5. Main data content
6. Empty/error/loading state

Example:

Inventory

- Title: Inventory
- Primary CTA: Add Item
- Search
- AI Smart Search
- Filter controls
- Inventory table/cards

## 8. Forms

Form rules:

- Use visible labels.
- Mark required fields clearly.
- Use inline validation messages.
- Do not rely on placeholders as labels.
- Group related fields.
- Use sensible defaults.
- Confirm destructive actions.
- Disable submit while saving.
- Preserve entered data if a network error occurs.

## 9. Cards

Cards should summarize rather than duplicate full detail pages.

### ProductionCard recommended contents

- title,
- date range,
- status badge,
- requirement count,
- unresolved action count.

### OrganizationCard recommended contents

- organization name,
- role/status,
- team summary,
- Enter action.

### Inventory mobile card recommended contents

- item name,
- category/team,
- quantity available / total,
- condition badge/summary,
- location.

Exact spacing and ordering may change during UI implementation, but avoid adding unrelated data.

## 10. Status and Badges

Use badges for compact status communication.

Examples:

- Admin
- Member
- Unassigned
- Planning
- Active
- Completed
- Needs Repair
- In Service
- Overdue
- Done

Text labels must remain readable without relying on color alone.

## 11. Empty States

Every list page should have a deliberate empty state.

Examples:

### No organizations

“You are not part of an organization yet.”

Actions:

- Create Organization
- Join Organization

### No inventory

“No inventory items have been added yet.”

If permitted:

- Add Item

### No productions

“No productions yet.”

If permitted:

- Create Production

## 12. Loading States

Use skeletons or concise loading indicators for data lists.

Avoid layout jumps when possible.

Long actions such as AI generation should show a specific progress state, e.g.:

“Generating requirement suggestions…”

## 13. Error States

Errors should explain what the user can do next.

Examples:

- Invalid organization code
- Permission denied
- Network error
- AI request failed
- Validation error

Do not show raw Firebase errors directly to users.

## 14. Permission UX

If the user has View but not Edit:

- show the data,
- hide/disable edit CTAs,
- do not make the page look broken.

If the user has None:

- remove module from normal navigation,
- direct URL should show a clear permission-denied state or redirect safely.

On the Dashboard, hide any summary card whose underlying module is not viewable rather than
showing an error or a zero. A member with no viewable module sees a deliberate empty state.

An Unassigned member never reaches these screens at all; they see the waiting state instead.

## 15. AI UX

AI must look integrated into the workflow, not like a floating chatbot.

### AI Smart Search

Place within Inventory search/filter area.

Show:

- user query,
- interpreted filters,
- real result count.

### AI Requirement Generator

Place inside Production Detail / Requirements.

Use a review workflow with selectable suggestion cards/rows.

Clearly label generated content as AI suggestions.

## 16. Accessibility

Minimum expectations:

- keyboard-focusable controls,
- visible focus states,
- adequate contrast,
- labels for inputs,
- semantic buttons/links,
- accessible dialogs,
- no information communicated only by color.

## 17. Mobile Minimum Target

The application should remain usable around common modern phone widths (approximately 360px and above).

Test at least:

- 375px mobile width,
- tablet width,
- standard desktop width.

## 18. Design Scope Control

Still deliberately out of scope. Do not spend MVP time on:

- custom animation systems,
- advanced chart libraries — the three charts in section 3d are built from
  inline SVG and CSS against theme tokens, with no charting dependency,
- elaborate illustrations,
- complex theme switching beyond the single light/dark choice described in
  section 3a,
- per-organization or account-synced themes — the theme is a browser-local
  preference on purpose,
- item photo galleries,
- any interface for a feature the MVP excludes; the current exclusion list
  lives in `README.md` and `docs/PROJECT_OVERVIEW.md`.

**Shipped since this section was first written.** QR labels appeared here as an
excluded feature until Phase 11I. They were built in Phase 11E and are part of
the product: printable label sheets, an equipment QR card on the unit page, and
the camera scanner. Their design rules are not "do not build this" — they are
in sections 3a (labels stay black on white whatever the theme) and 17.

Focus on clarity and completion.
