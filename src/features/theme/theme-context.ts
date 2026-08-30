import { createContext } from 'react'
import type { Theme } from '@/domain/theme'

export interface ThemeState {
  /** The theme currently on the document. */
  theme: Theme
  /** Switch to the other one and remember it. */
  toggleTheme: () => void
  /** Choose a specific one and remember it. */
  setTheme: (theme: Theme) => void
}

export const ThemeContext = createContext<ThemeState | undefined>(undefined)
