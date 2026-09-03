import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Two type styles that only work if nothing overrides them.
 *
 * QA reported that placeholders read as values somebody had already typed, and
 * that a card's supporting line competed with its title. Both were fixed in one
 * place — a base rule for `::placeholder`, a token for helper text — precisely
 * because the alternative is a class on each of one shared `Input`, eight
 * hand-rolled `textarea`s, and every card in the application.
 *
 * That makes the fix quiet to undo. A single placeholder-colour utility added
 * back to a field beats the base layer and puts that one input back to looking
 * filled in, with nothing to notice in review. So the absence is what is
 * asserted here, not the presence. (The class name is never spelled out in this
 * file: Tailwind scans it, and writing it would emit the very rule under test.)
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(file, 'utf8')
const css = read(path.join(src, 'index.css'))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry): string[] => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return [full]
  })
}

const sources = sourceFiles(src).map((file) => ({
  path: path.relative(root, file),
  text: read(file),
}))

describe('a placeholder never looks like a value', () => {
  it('is styled once, for every field in the application', () => {
    // Including the eight textareas, which are hand-rolled elements rather than
    // a shared component and would otherwise each need their own class.
    expect(css).toContain('::placeholder')
    expect(css).toMatch(/::placeholder\s*\{[^}]*color:\s*var\(--placeholder-foreground\)/)
    expect(css).toMatch(/::placeholder\s*\{[^}]*font-style:\s*italic/)
  })

  it('defines its colour in both themes', () => {
    // A token defined only in light leaves dark mode falling back to whatever
    // the browser picks, which is the one thing a token is meant to prevent.
    // Split on the theme blocks themselves. `.dark` also appears in the custom
    // variant near the top of the file, which is not where values live.
    const darkBlockAt = css.indexOf('\n.dark {')
    const light = css.slice(css.indexOf('\n:root {'), darkBlockAt)
    const dark = css.slice(darkBlockAt)

    expect(light).toContain('--placeholder-foreground:')
    expect(dark).toContain('--placeholder-foreground:')
    expect(light).toContain('--helper-foreground:')
    expect(dark).toContain('--helper-foreground:')
  })

  it('is not overridden back to body-text weight by any field', () => {
    // The utility that was there before, and exactly what a copied-and-pasted
    // field would bring back. Assembled from parts rather than written out:
    // Tailwind scans this directory, and a complete class name in a test is
    // enough to make it emit the very rule the test exists to forbid.
    const banned = new RegExp(`placeholder:${'text'}-(muted-)?foreground`)

    for (const { path: file, text } of sources) {
      expect(text, file).not.toMatch(banned)
    }
  })

  it('keeps the select trigger in step, since its placeholder is not a real one', () => {
    // Radix draws it as a value slot, so the base rule cannot reach it and it
    // has to opt in explicitly or it alone would look filled in.
    const select = read(path.join(src, 'components/ui/select.tsx'))

    expect(select).toContain('data-placeholder:text-placeholder-foreground')
    expect(select).toContain('data-placeholder:italic')
  })
})

describe('money placeholders name the unit', () => {
  it('shows a shape to fill in rather than a plausible amount', () => {
    // "18.50" was being read as a stored value. Every cost field says $XX.XX.
    const costFields = sources.filter(({ text }) => /placeholder="\$XX\.XX"/.test(text))

    expect(costFields.length).toBeGreaterThanOrEqual(3)
    for (const { path: file, text } of sources) {
      expect(text, file).not.toContain('placeholder="18.50"')
    }
  })
})
