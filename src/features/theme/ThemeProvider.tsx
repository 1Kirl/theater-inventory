import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { nextTheme, type Theme } from '@/domain/theme'
import { applyTheme } from '@/features/theme/apply-theme'
import { readStoredTheme, writeStoredTheme } from '@/features/theme/theme-storage'
import { ThemeContext, type ThemeState } from '@/features/theme/theme-context'

/**
 * Holds the chosen theme and keeps the document in step with it.
 *
 * The initial value is read from storage during the first render rather than in
 * an effect, so React's first paint already agrees with what the boot script in
 * `index.html` put on the document. An effect would run after that paint, and
 * the disagreement in between is the flash this is meant to avoid.
 *
 * The theme is a property of the browser, not of the account or the
 * organization. Nothing here depends on auth or on the active organization, and
 * this provider deliberately sits outside both — signing out unmounts neither
 * the provider nor the preference.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  // Reconciles the document with React's state. The boot script already set
  // both for the first paint, so on load this repeats what is there; it earns
  // its place on every change after that, and when React is mounted into a
  // document some other code has touched.
  useEffect(() => {
    applyTheme(document.documentElement, theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    // Written here rather than in the effect above so that persistence follows
    // an actual choice. An effect would also fire on mount and rewrite a value
    // the user never picked.
    writeStoredTheme(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = nextTheme(current)
      writeStoredTheme(next)
      return next
    })
  }, [])

  const value = useMemo<ThemeState>(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
