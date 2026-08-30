import { DARK_CLASS, colorSchemeFor, type Theme } from '@/domain/theme'

/**
 * The part of the document element this writes to.
 *
 * `HTMLElement` satisfies this structurally, so the real call site passes
 * `document.documentElement` and a test passes an object it can inspect.
 */
export interface ThemeTarget {
  classList: {
    add: (token: string) => void
    remove: (token: string) => void
  }
  style: { colorScheme: string }
}

/**
 * Put a theme on the document.
 *
 * The class goes on the root element rather than the body for two reasons: the
 * dark variant is defined as `&:is(.dark *)`, so every styled element has to be
 * a descendant of whatever carries it, and the page background is painted from
 * the root before the body exists.
 *
 * `colorScheme` is set alongside it so that native controls follow — see
 * `colorSchemeFor`.
 */
export function applyTheme(target: ThemeTarget, theme: Theme): void {
  if (theme === 'dark') {
    target.classList.add(DARK_CLASS)
  } else {
    target.classList.remove(DARK_CLASS)
  }

  target.style.colorScheme = colorSchemeFor(theme)
}
