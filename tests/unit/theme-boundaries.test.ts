import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { STATUS_TONES } from '@/domain/status-tone'

/**
 * The two places the theme must *not* reach.
 *
 * Dark mode is a screen preference. It has no business deciding what the
 * operating system thinks, and none at all deciding what comes out of a
 * printer. Both boundaries are one careless edit away from being lost — a
 * blanket replacement of hard-coded colours with tokens would quietly turn
 * every printed QR label dark — so they are asserted rather than remembered.
 */

const src = path.resolve(import.meta.dirname, '../../src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): string[] => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    return [full]
  })
}

const read = (relative: string) => readFileSync(path.join(src, relative), 'utf8')

describe('the operating system does not choose the theme', () => {
  it('1. no source file reads the system colour preference', () => {
    const offenders = sourceFiles(src).filter((file) => {
      const text = readFileSync(file, 'utf8')
      return text.includes('prefers-color-scheme') || text.includes('matchMedia')
    })

    expect(offenders.map((file) => path.relative(src, file))).toEqual([])
  })

  it('2. the stylesheet has no system-preference media query', () => {
    expect(read('index.css')).not.toContain('prefers-color-scheme')
  })
})

describe('light and dark are one design system', () => {
  const css = read('index.css')

  function tokensIn(selector: string): Set<string> {
    const match = new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`).exec(css)
    if (match?.[1] === undefined) throw new Error(`No ${selector} block in index.css.`)
    return new Set([...match[1].matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1] as string))
  }

  const light = tokensIn(':root')
  const dark = tokensIn('\\.dark')

  it('3. every colour token defined for light is defined for dark', () => {
    // The rule Extension C had to hold to: a pastel added to :root and forgotten
    // in .dark leaves dark mode on the previous palette for that one surface,
    // which is exactly how a theme drifts apart one commit at a time.
    // `--radius` is the only intentional exception; it is not a colour.
    const missing = [...light].filter((token) => token !== '--radius' && !dark.has(token))
    expect(missing).toEqual([])
  })

  it('4. dark defines nothing light does not', () => {
    expect([...dark].filter((token) => !light.has(token))).toEqual([])
  })

  it('5. every status tone exists in both themes', () => {
    for (const tone of STATUS_TONES) {
      expect(light.has(`--tone-${tone}`)).toBe(true)
      expect(dark.has(`--tone-${tone}`)).toBe(true)
    }
  })

  it('6. the chart palette exists in both themes', () => {
    for (let index = 1; index <= 6; index += 1) {
      expect(light.has(`--chart-${String(index)}`)).toBe(true)
      expect(dark.has(`--chart-${String(index)}`)).toBe(true)
    }
  })

  it('7. charts take their colours from tokens, never from literals', () => {
    // A hex in a chart module would be a colour that cannot follow the theme,
    // which is how a dark-mode chart ends up with invisible wedges.
    for (const file of sourceFiles(path.join(src, 'components/charts'))) {
      const text = readFileSync(file, 'utf8')
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(text).not.toMatch(/\brgba?\(/)
    }
  })

  it('8. the status badge resolves a class for every tone', () => {
    const badge = read('components/ui/status-badge.tsx')
    for (const tone of STATUS_TONES) {
      expect(badge).toContain(`text-tone-${tone}`)
    }
  })
})

describe('printed labels stay printable', () => {
  const sheet = read('features/inventory/EquipmentLabelSheet.tsx')

  it('9. the QR keeps an explicit white background and black modules', () => {
    expect(sheet).toContain('bgColor="#ffffff"')
    expect(sheet).toContain('fgColor="#000000"')
  })

  it('10. a label is black on white regardless of the application theme', () => {
    expect(sheet).toContain('background: #fff')
    expect(sheet).toContain('color: #000')
  })

  it('11. the label carries no dark variant', () => {
    expect(sheet).not.toContain('dark:')
  })

  it('12. printers are told to keep the quiet zone rather than drop it', () => {
    expect(sheet).toContain('print-color-adjust: exact')
  })

  it('13. the on-screen QR tile keeps its white quiet zone', () => {
    expect(read('features/inventory/EquipmentQrCard.tsx')).toContain('bg-white')
  })

  it('14. the page a label prints on is white', () => {
    const css = read('index.css')
    expect(css).toContain('@media print')
    expect(css.slice(css.indexOf('@media print'))).toContain('background: #fff !important')
  })
})

describe('the camera feed is not themed', () => {
  const scanner = read('features/scanner/ScannerPage.tsx')
  const video = scanner.slice(scanner.indexOf('<video'), scanner.indexOf('</video>') + 8)

  it('15. nothing tints or filters the preview', () => {
    for (const property of ['filter', 'opacity', 'invert', 'grayscale', 'mix-blend']) {
      expect(video).not.toContain(property)
    }
  })
})
