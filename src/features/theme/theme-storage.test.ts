import { describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY } from '@/domain/theme'
import { STORAGE_KEY as ORGANIZATION_STORAGE_KEY } from '@/features/organizations/OrganizationProvider'
import { readStoredTheme, writeStoredTheme, type ThemeStorage } from '@/features/theme/theme-storage'

/** A localStorage stand-in whose contents a test can inspect. */
function fakeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))

  return {
    storage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) },
    } satisfies ThemeStorage,
    entries,
    /** What signing out and switching organization do, and only that. */
    removeOrganization: () => { entries.delete(ORGANIZATION_STORAGE_KEY) },
  }
}

describe('reading the stored theme', () => {
  it('1. no stored preference is light', () => {
    expect(readStoredTheme(fakeStorage().storage)).toBe('light')
  })

  it('2. a stored light is light', () => {
    const { storage } = fakeStorage({ [THEME_STORAGE_KEY]: 'light' })
    expect(readStoredTheme(storage)).toBe('light')
  })

  it('3. a stored dark is dark', () => {
    const { storage } = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' })
    expect(readStoredTheme(storage)).toBe('dark')
  })

  it('4. an invalid stored value is light', () => {
    const { storage } = fakeStorage({ [THEME_STORAGE_KEY]: 'system' })
    expect(readStoredTheme(storage)).toBe('light')
  })

  it('5. no storage at all is light', () => {
    expect(readStoredTheme(null)).toBe('light')
  })

  it('6. storage that throws on read is light rather than a crash', () => {
    const hostile: ThemeStorage = {
      getItem: () => { throw new Error('site data is blocked') },
      setItem: () => { throw new Error('site data is blocked') },
    }
    expect(readStoredTheme(hostile)).toBe('light')
  })

  it('7. a value under another key is ignored', () => {
    const { storage } = fakeStorage({ theme: 'dark', 'color-scheme': 'dark' })
    expect(readStoredTheme(storage)).toBe('light')
  })
})

describe('writing the stored theme', () => {
  it('8. a switch to dark survives a re-read', () => {
    const { storage } = fakeStorage()
    writeStoredTheme('dark', storage)
    expect(readStoredTheme(storage)).toBe('dark')
  })

  it('9. a switch back to light survives a re-read', () => {
    const { storage } = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' })
    writeStoredTheme('light', storage)
    expect(readStoredTheme(storage)).toBe('light')
  })

  it('10. only the one key is written', () => {
    const { storage, entries } = fakeStorage()
    writeStoredTheme('dark', storage)
    expect([...entries.keys()]).toEqual([THEME_STORAGE_KEY])
  })

  it('11. storage that throws on write is silent, and the app keeps running', () => {
    const hostile: ThemeStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded') },
    }
    expect(() => { writeStoredTheme('dark', hostile) }).not.toThrow()
  })

  it('12. no storage at all is silent', () => {
    expect(() => { writeStoredTheme('dark', null) }).not.toThrow()
  })
})

describe('the theme outlives auth and organization', () => {
  it('13. the theme key is not the active-organization key', () => {
    expect(THEME_STORAGE_KEY).not.toBe(ORGANIZATION_STORAGE_KEY)
  })

  it('14. signing out clears the organization and leaves the theme', () => {
    const { storage, removeOrganization } = fakeStorage({
      [THEME_STORAGE_KEY]: 'dark',
      [ORGANIZATION_STORAGE_KEY]: 'org-1',
    })

    removeOrganization()

    expect(readStoredTheme(storage)).toBe('dark')
  })

  it('15. switching organization leaves the theme', () => {
    const { storage, entries } = fakeStorage({
      [THEME_STORAGE_KEY]: 'dark',
      [ORGANIZATION_STORAGE_KEY]: 'org-1',
    })

    // Switching is a clear followed by a select; neither goes near the theme.
    entries.delete(ORGANIZATION_STORAGE_KEY)
    entries.set(ORGANIZATION_STORAGE_KEY, 'org-2')

    expect(readStoredTheme(storage)).toBe('dark')
    expect(entries.get(ORGANIZATION_STORAGE_KEY)).toBe('org-2')
  })

  it('16. a light choice survives the same round trip', () => {
    const { storage, removeOrganization } = fakeStorage({
      [THEME_STORAGE_KEY]: 'light',
      [ORGANIZATION_STORAGE_KEY]: 'org-1',
    })

    removeOrganization()

    expect(readStoredTheme(storage)).toBe('light')
  })
})
