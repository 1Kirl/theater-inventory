import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A card's top inset is the card's own padding, and only that.
 *
 * Every headerless card in the product carried `pt-6` on its `CardContent`. The
 * `Card` primitive already pads itself evenly — `py-(--card-spacing)` — so that
 * class did not set the top inset, it *doubled* it: forty pixels above the
 * content against sixteen below. Twenty-four pixels is about one line of text,
 * which is exactly what it looked like — a blank row where a subtitle would go,
 * on cards that have no subtitle.
 *
 * The habit comes from a Card that pads nothing and a CardHeader that pads the
 * top; add a header-shaped inset when there is no header and the arithmetic
 * works. This project's Card is not that Card, and every one of the twenty-four
 * uses was wrong in the same way — which is why the fix is a deletion rather
 * than a new spacing rule.
 *
 * What is asserted here is the rule, not the pixels: nothing re-pads the top of
 * a card from the outside, and the primitive that does the padding still does.
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return full.endsWith('.tsx') ? [full] : []
  })
}

const SOURCES = tsxFiles('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const card = readFileSync(new URL('../../src/components/ui/card.tsx', import.meta.url), 'utf8')

describe('the card primitive owns its own inset', () => {
  it('pads the card evenly, top and bottom', () => {
    expect(card).toContain('py-(--card-spacing)')
  })

  it('gives the content the horizontal inset only, so it cannot double the top', () => {
    const content = card.slice(card.indexOf('function CardContent'))
    expect(content.slice(0, content.indexOf('/>'))).toContain('px-(--card-spacing)')
    expect(content.slice(0, content.indexOf('/>'))).not.toMatch(/\bpy-|\bpt-/)
  })

  it('reserves a description row only when there is a description', () => {
    // Not the cause here, and worth keeping that way: a header that always
    // reserved two rows would produce the same phantom line on every card with
    // a title and nothing under it.
    // Every reservation of the second row is guarded by the description being
    // present — asserted by counting, because a second unguarded occurrence is
    // exactly how this would regress.
    const reserved = [...card.matchAll(/grid-rows-\[auto_auto\]/g)].length
    const guarded = [...card.matchAll(/has-data-\[slot=card-description\]:grid-rows-\[auto_auto\]/g)].length

    expect(reserved).toBeGreaterThan(0)
    expect(guarded).toBe(reserved)
  })
})

describe('nothing re-pads a card from the outside', () => {
  const offenders = SOURCES.flatMap(({ path, text }) =>
    [...text.matchAll(/CardContent className="([^"]*)"/g)]
      .filter((m) => /\bpt-\d/.test(m[1] as string))
      .map((m) => `${path}: ${m[1] as string}`))

  it('adds no top padding to any CardContent', () => {
    expect(offenders).toEqual([])
  })

  it('adds no top margin to any CardContent either', () => {
    const withMargin = SOURCES.flatMap(({ path, text }) =>
      [...text.matchAll(/CardContent className="([^"]*)"/g)]
        .filter((m) => /\bmt-\d/.test(m[1] as string))
        .map((m) => `${path}: ${m[1] as string}`))

    expect(withMargin).toEqual([])
  })

  it('fakes no alignment with a negative margin or a transform', () => {
    const hacks = SOURCES.flatMap(({ path, text }) =>
      [...text.matchAll(/CardContent className="([^"]*)"/g)]
        .filter((m) => /-m[tblrxy]?-|translate-y/.test(m[1] as string))
        .map((m) => `${path}: ${m[1] as string}`))

    expect(hacks).toEqual([])
  })
})

/**
 * The pages the phantom row was reported on. Named individually because a
 * general rule is easy to satisfy while one page quietly reintroduces the
 * class, and these are the five somebody actually looked at.
 */
describe('the reported surfaces start with their content', () => {
  const REPORTED = [
    'src/features/inventory/InventoryListPage.tsx',
    'src/features/maintenance/MaintenanceListPage.tsx',
    'src/features/productions/ActionListPage.tsx',
    'src/features/calendar/CalendarPage.tsx',
    'src/features/contacts/ContactsPage.tsx',
  ]

  it.each(REPORTED)('%s reserves no blank first row', (path) => {
    const text = readFileSync(path, 'utf8')
    expect(text).not.toMatch(/CardContent className="[^"]*\bpt-\d/)
  })

  it.each(REPORTED)('%s still lets its card pad itself', (path) => {
    // The fix is a deletion. If a page ever answers this with its own padding
    // instead, the inset stops being one rule and starts being five.
    const text = readFileSync(path, 'utf8')
    expect(text).not.toMatch(/CardContent className="[^"]*\bp-\d/)
  })
})

describe('cards that genuinely have a description keep their spacing', () => {
  const withDescription = SOURCES.filter(({ text }) => text.includes('<CardDescription'))

  it('still exist, so the rule above did not delete them', () => {
    expect(withDescription.length).toBeGreaterThan(0)
  })

  it('render the description as a real element rather than an empty one', () => {
    // An always-rendered empty description would reserve exactly the row this
    // whole change removed.
    for (const { path, text } of withDescription) {
      expect(text, path).not.toMatch(/<CardDescription[^>]*>\s*<\/CardDescription>/)
      expect(text, path).not.toMatch(/<CardDescription[^>]*\/>/)
    }
  })

  it('keeps the gap between a title and its description in the primitive', () => {
    // The point is that one component owns this spacing, not that it has a
    // particular value: a per-card gap is what this whole file exists to
    // prevent. QA-03 tightened it from gap-1 so a description reads as
    // belonging to the title above it rather than floating between two cards,
    // and the value is pinned here so that change is deliberate next time too.
    const header = card.slice(card.indexOf('function CardHeader'))
    const declaration = header.slice(0, header.indexOf('/>'))

    expect(declaration).toMatch(/\bgap-0\.5\b/)
  })

  it('draws a description one step back from body text', () => {
    // QA-03 again: supporting copy must sit below the title in the hierarchy.
    // `helper-foreground` is a token of its own rather than `muted-foreground`,
    // which the application also uses for ordinary secondary text.
    const description = card.slice(card.indexOf('function CardDescription'))

    expect(description.slice(0, description.indexOf('/>'))).toContain('text-helper-foreground')
  })
})
