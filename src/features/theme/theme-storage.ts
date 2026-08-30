import { DEFAULT_THEME, THEME_STORAGE_KEY, normalizeTheme, type Theme } from '@/domain/theme'

/**
 * The part of `Storage` this needs.
 *
 * Narrow on purpose: it is what makes the read and the write testable without a
 * browser, and it documents that nothing here ever calls `clear()`. Clearing
 * storage would take the active organization with it.
 */
export interface ThemeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * The browser's storage, or nothing.
 *
 * Reading `window.localStorage` is itself capable of throwing — a private
 * window, or a browser configured to block site data — so the access is guarded
 * rather than assumed, the same way the active organization guards it.
 */
export function browserThemeStorage(): ThemeStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The theme this browser last chose.
 *
 * Every way of not having an answer — no storage, no key, a value this
 * application did not write — resolves to light, because light is the product
 * default rather than a fallback for failure.
 */
export function readStoredTheme(storage: ThemeStorage | null = browserThemeStorage()): Theme {
  if (storage === null) return DEFAULT_THEME

  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/**
 * Remember the choice.
 *
 * A failure is silent. Storage being unavailable means the preference lasts for
 * this page only, which is a worse experience but not one worth an error
 * message in front of somebody who only wanted to dim the screen.
 */
export function writeStoredTheme(
  theme: Theme,
  storage: ThemeStorage | null = browserThemeStorage(),
): void {
  if (storage === null) return

  try {
    storage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Nothing to do and nothing worth saying.
  }
}
