import { describe, expect, it } from 'vitest'
import { applyTheme, type ThemeTarget } from '@/features/theme/apply-theme'

/** Stands in for `document.documentElement` and records what was done to it. */
function fakeRoot() {
  const classes = new Set<string>()
  const target: ThemeTarget = {
    classList: {
      add: (token: string) => { classes.add(token) },
      remove: (token: string) => { classes.delete(token) },
    },
    style: { colorScheme: '' },
  }
  return { target, classes }
}

describe('applyTheme', () => {
  it('1. dark puts the dark class on the root', () => {
    const { target, classes } = fakeRoot()
    applyTheme(target, 'dark')
    expect(classes.has('dark')).toBe(true)
  })

  it('2. light leaves no dark class on the root', () => {
    const { target, classes } = fakeRoot()
    applyTheme(target, 'light')
    expect(classes.has('dark')).toBe(false)
  })

  it('3. switching to light removes a dark class that was already there', () => {
    const { target, classes } = fakeRoot()
    applyTheme(target, 'dark')
    applyTheme(target, 'light')
    expect(classes.has('dark')).toBe(false)
  })

  it('4. switching back and forth ends where it should', () => {
    const { target, classes } = fakeRoot()
    applyTheme(target, 'dark')
    applyTheme(target, 'light')
    applyTheme(target, 'dark')
    expect([...classes]).toEqual(['dark'])
  })

  it('5. applying the same theme twice is not cumulative', () => {
    const { target, classes } = fakeRoot()
    applyTheme(target, 'dark')
    applyTheme(target, 'dark')
    expect([...classes]).toEqual(['dark'])
  })

  it('6. dark declares a dark color-scheme for native controls', () => {
    const { target } = fakeRoot()
    applyTheme(target, 'dark')
    expect(target.style.colorScheme).toBe('dark')
  })

  it('7. light declares a light color-scheme', () => {
    const { target } = fakeRoot()
    applyTheme(target, 'dark')
    applyTheme(target, 'light')
    expect(target.style.colorScheme).toBe('light')
  })

  it('8. no other class on the root is disturbed', () => {
    const { target, classes } = fakeRoot()
    classes.add('some-other-class')
    applyTheme(target, 'dark')
    applyTheme(target, 'light')
    expect(classes.has('some-other-class')).toBe(true)
  })
})
