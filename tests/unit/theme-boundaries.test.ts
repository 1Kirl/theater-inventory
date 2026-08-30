import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

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

describe('printed labels stay printable', () => {
  const sheet = read('features/inventory/EquipmentLabelSheet.tsx')

  it('3. the QR keeps an explicit white background and black modules', () => {
    expect(sheet).toContain('bgColor="#ffffff"')
    expect(sheet).toContain('fgColor="#000000"')
  })

  it('4. a label is black on white regardless of the application theme', () => {
    expect(sheet).toContain('background: #fff')
    expect(sheet).toContain('color: #000')
  })

  it('5. the label carries no dark variant', () => {
    expect(sheet).not.toContain('dark:')
  })

  it('6. printers are told to keep the quiet zone rather than drop it', () => {
    expect(sheet).toContain('print-color-adjust: exact')
  })

  it('7. the on-screen QR tile keeps its white quiet zone', () => {
    expect(read('features/inventory/EquipmentQrCard.tsx')).toContain('bg-white')
  })

  it('8. the page a label prints on is white', () => {
    const css = read('index.css')
    expect(css).toContain('@media print')
    expect(css.slice(css.indexOf('@media print'))).toContain('background: #fff !important')
  })
})

describe('the camera feed is not themed', () => {
  const scanner = read('features/scanner/ScannerPage.tsx')
  const video = scanner.slice(scanner.indexOf('<video'), scanner.indexOf('</video>') + 8)

  it('9. nothing tints or filters the preview', () => {
    for (const property of ['filter', 'opacity', 'invert', 'grayscale', 'mix-blend']) {
      expect(video).not.toContain(property)
    }
  })
})
