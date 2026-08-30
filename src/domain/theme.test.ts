import { describe, expect, it } from 'vitest'
import {
  DARK_CLASS,
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  colorSchemeFor,
  isTheme,
  nextTheme,
  normalizeTheme,
  themeToggleLabel,
} from '@/domain/theme'

describe('theme defaults', () => {
  it('1. the product default is light', () => {
    expect(DEFAULT_THEME).toBe('light')
  })

  it('2. there are exactly two themes', () => {
    expect(THEMES).toEqual(['light', 'dark'])
  })

  it('3. the storage key is namespaced to this application', () => {
    expect(THEME_STORAGE_KEY).toBe('theater-inventory.theme')
  })

  it('4. the dark class is the one the stylesheet defines', () => {
    expect(DARK_CLASS).toBe('dark')
  })
})

describe('normalizeTheme', () => {
  it('5. a missing preference is light', () => {
    expect(normalizeTheme(null)).toBe('light')
    expect(normalizeTheme(undefined)).toBe('light')
  })

  it('6. a persisted light is light', () => {
    expect(normalizeTheme('light')).toBe('light')
  })

  it('7. a persisted dark is dark', () => {
    expect(normalizeTheme('dark')).toBe('dark')
  })

  it('8. an unrecognised value is light', () => {
    for (const value of ['Dark', 'DARK', 'system', 'auto', '', ' dark', 'dark ', 'true']) {
      expect(normalizeTheme(value)).toBe('light')
    }
  })

  it('9. a value of the wrong type is light rather than a crash', () => {
    for (const value of [0, 1, {}, [], true, false, Symbol('dark')]) {
      expect(normalizeTheme(value)).toBe('light')
    }
  })

  it('10. the system preference is never consulted, because nothing is passed one', () => {
    // A guard against someone reintroducing `prefers-color-scheme` here: the
    // function takes a stored value and has no other input.
    expect(normalizeTheme.length).toBe(1)
  })
})

describe('isTheme', () => {
  it('11. accepts only the two written values', () => {
    expect(isTheme('light')).toBe(true)
    expect(isTheme('dark')).toBe(true)
    expect(isTheme('system')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })
})

describe('nextTheme', () => {
  it('12. light switches to dark', () => {
    expect(nextTheme('light')).toBe('dark')
  })

  it('13. dark switches to light', () => {
    expect(nextTheme('dark')).toBe('light')
  })

  it('14. two switches return to where it started', () => {
    expect(nextTheme(nextTheme('light'))).toBe('light')
    expect(nextTheme(nextTheme('dark'))).toBe('dark')
  })
})

describe('themeToggleLabel', () => {
  it('15. names the destination, not the current mode', () => {
    expect(themeToggleLabel('light')).toBe('Switch to dark mode')
    expect(themeToggleLabel('dark')).toBe('Switch to light mode')
  })

  it('16. the two labels differ, so the control is never ambiguous', () => {
    expect(themeToggleLabel('light')).not.toBe(themeToggleLabel('dark'))
  })
})

describe('colorSchemeFor', () => {
  it('17. reports the scheme native controls should use', () => {
    expect(colorSchemeFor('light')).toBe('light')
    expect(colorSchemeFor('dark')).toBe('dark')
  })
})
