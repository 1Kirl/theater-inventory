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

Do not spend MVP time on:

- custom animation systems,
- advanced chart libraries,
- elaborate illustrations,
- complex theme switching beyond the single light/dark choice described in section 3a,
- per-organization or account-synced themes,
- item photo galleries, QR labels, or any interface for features excluded from the MVP.

Focus on clarity and completion.
