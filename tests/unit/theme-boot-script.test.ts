import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DARK_CLASS, THEME_STORAGE_KEY } from '@/domain/theme'

/**
 * The theme has one piece of logic that cannot be a module: the snippet in
 * `index.html` that runs before the first paint. It is duplicated by necessity,
 * so it is tested rather than trusted — both that it still agrees with the
 * constants beside it, and that it actually decides the right thing.
 */
const html = readFileSync(
  path.resolve(import.meta.dirname, '../../index.html'),
  'utf8',
)

function bootScriptSource(): string {
  const match = /<script id="theme-boot">([\s\S]*?)<\/script>/.exec(html)
  if (match?.[1] === undefined) {
    throw new Error('index.html no longer contains a script with id="theme-boot".')
  }
  return match[1]
}

/** Runs the snippet against stand-ins, and reports what it did to the root. */
function runBootScript(stored: string | null | (() => never)) {
  const classes = new Set<string>()
  const root = {
    classList: {
      add: (token: string) => { classes.add(token) },
      remove: (token: string) => { classes.delete(token) },
    },
    style: { colorScheme: '' },
  }

  const localStorage = {
    getItem: () => {
      if (typeof stored === 'function') stored()
      return stored as string | null
    },
  }

  // The snippet reads `localStorage` and `document` as free variables, which is
  // exactly what a browser gives it.
  const run = new Function('localStorage', 'document', bootScriptSource()) as (
    storage: unknown,
    doc: unknown,
  ) => void

  run(localStorage, { documentElement: root })

  return { classes, colorScheme: root.style.colorScheme }
}

describe('the boot script agrees with the theme module', () => {
  it('1. index.html carries a theme boot script', () => {
    expect(bootScriptSource().length).toBeGreaterThan(0)
  })

  it('2. it reads the same storage key the application writes', () => {
    expect(bootScriptSource()).toContain(THEME_STORAGE_KEY)
  })

  it('3. it applies the same class the stylesheet defines', () => {
    expect(bootScriptSource()).toContain(`'${DARK_CLASS}'`)
  })

  it('4. it runs before the application module, not after it', () => {
    const bootAt = html.indexOf('id="theme-boot"')
    const moduleAt = html.indexOf('src="/src/main.tsx"')
    expect(bootAt).toBeGreaterThan(-1)
    expect(moduleAt).toBeGreaterThan(-1)
    expect(bootAt).toBeLessThan(moduleAt)
  })

  it('5. it is inline, so nothing has to be fetched before the first paint', () => {
    expect(/<script id="theme-boot"[^>]*\ssrc=/.test(html)).toBe(false)
    expect(/<script id="theme-boot"[^>]*\stype="module"/.test(html)).toBe(false)
  })

  it('6. it never consults the operating system preference', () => {
    expect(bootScriptSource()).not.toContain('matchMedia')
    expect(bootScriptSource()).not.toContain('prefers-color-scheme')
  })
})

describe('what the boot script decides', () => {
  it('7. a stored dark is dark before React exists', () => {
    const { classes, colorScheme } = runBootScript('dark')
    expect(classes.has(DARK_CLASS)).toBe(true)
    expect(colorScheme).toBe('dark')
  })

  it('8. a stored light is light', () => {
    const { classes, colorScheme } = runBootScript('light')
    expect(classes.has(DARK_CLASS)).toBe(false)
    expect(colorScheme).toBe('light')
  })

  it('9. no stored preference is light', () => {
    const { classes, colorScheme } = runBootScript(null)
    expect(classes.has(DARK_CLASS)).toBe(false)
    expect(colorScheme).toBe('light')
  })

  it('10. an invalid stored value is light', () => {
    for (const value of ['system', 'DARK', 'auto', '']) {
      expect(runBootScript(value).classes.has(DARK_CLASS)).toBe(false)
    }
  })

  it('11. storage that throws does not break the page load', () => {
    const throwing = () => { throw new Error('site data is blocked') }
    expect(() => runBootScript(throwing as never)).not.toThrow()
    expect(runBootScript(throwing as never).classes.has(DARK_CLASS)).toBe(false)
  })
})
