import { useContext } from 'react'
import { ThemeContext, type ThemeState } from '@/features/theme/theme-context'

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)

  if (context === undefined) {
    throw new Error('useTheme must be used inside a ThemeProvider.')
  }

  return context
}
