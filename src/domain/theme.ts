/**
 * Light and dark, and the rules for choosing between them.
 *
 * The product default is light. The operating system's preference is
 * deliberately not consulted: a theater department's machines are shared and
 * often left on whatever the last person set, so a school laptop that happens
 * to be in OS dark mode should not decide what this application looks like.
 * Dark is something a person chooses here, and once chosen it is remembered.
 *
 * Everything in this module is pure. Reading the choice back, writing it, and
 * putting it on the document are three separate concerns that live next to it,
 * so that the decisions themselves can be tested without a browser.
 */

export const THEMES = ['light', 'dark'] as const

export type Theme = (typeof THEMES)[number]

/** What a user who has never chosen sees. */
export const DEFAULT_THEME: Theme = 'light'

/**
 * Where the choice is kept.
 *
 * Namespaced the same way as the active organization, and separate from it, so
 * that signing out or switching organization — which clears that key — cannot
 * reach this one.
 */
export const THEME_STORAGE_KEY = 'theater-inventory.theme'

/** The class the document carries while dark is active. */
export const DARK_CLASS = 'dark'

/**
 * The theme a stored value means.
 *
 * Anything that is not exactly one of the two known values — a key that was
 * never written, a truncated write, something another script left behind — is
 * the absence of a choice, and the absence of a choice is light.
 */
export function normalizeTheme(value: unknown): Theme {
  return value === 'dark' || value === 'light' ? value : DEFAULT_THEME
}

/** Whether a stored value is one this application wrote. */
export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light'
}

/** The theme the toggle switches to. */
export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

/**
 * What the toggle is called.
 *
 * Named for what it does rather than what is showing, because a screen reader
 * announces a control by its action; "Dark mode" beside a moon says nothing
 * about which direction pressing it goes.
 */
export function themeToggleLabel(theme: Theme): string {
  return theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
}

/**
 * The `color-scheme` the document declares.
 *
 * This is what native browser chrome reads: date and time pickers, number
 * spinners, scrollbars, autofill backgrounds. Without it those keep their light
 * rendering and appear as bright rectangles inside an otherwise dark form, and
 * autofilled text can end up unreadable. Tailwind classes cannot reach any of
 * them.
 */
export function colorSchemeFor(theme: Theme): string {
  return theme === 'dark' ? 'dark' : 'light'
}
