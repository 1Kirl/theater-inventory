import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Two vertical-balance fixes, and the mobile contract they had to not break.
 *
 * Both faults came from the same place: a CSS grid stretches its items to the
 * tallest in the row, and neither card did anything with the height it was
 * given. The headline numbers sat at the top of a stretched card with the
 * surplus below them, and the equipment ring did the same beside a taller
 * category list.
 *
 * The equipment card was then rebuilt as a vertical composition — ring, then
 * legend — which is both the fix for a cramped ring and the removal of the
 * arrangement that caused its old mobile bugs.
 *
 * Neither was fixed by adding padding or by setting a height, because both of
 * those break at the width where a label wraps to two lines. The headline cards
 * claim the stretched height and centre inside it, which is a no-op when there
 * is no surplus — the case on a phone, where the grid is a single column. The
 * equipment card claims the height too, and centres one container holding both
 * the ring and its legend — centring them as two siblings was what left the
 * ring sitting low, because the surplus was spread around each of them
 * separately rather than around the composition.
 *
 * This file reads the source rather than rendering it. That is a real limit: it
 * cannot prove the pixels. What it can prove is that the specific mechanisms
 * that caused the defects, and the ones that fixed them, are still where they
 * were put — including the mobile legend rules that a previous phone bug
 * produced and that a desktop alignment change would be very easy to undo.
 */

const dashboard = readFileSync(
  new URL('../../src/features/dashboard/DashboardPage.tsx', import.meta.url), 'utf8',
)
const legend = readFileSync(
  new URL('../../src/components/charts/ChartLegend.tsx', import.meta.url), 'utf8',
)

/** The `<Card…>` through to the end of the Metric component. */
const metric = dashboard.slice(dashboard.indexOf('function Metric('), dashboard.indexOf('/** A contained failure.'))

/**
 * The Equipment status card.
 *
 * Anchored on the title element rather than the words, which also appear in the
 * accessible summary the chart is labelled with further up the file.
 */
const equipment = dashboard.slice(
  dashboard.indexOf('<CardTitle className="text-base">Equipment status</CardTitle>'),
  dashboard.indexOf('Inventory by category'),
)

describe('the headline cards centre their content', () => {
  it('claims the height the grid row stretched it to', () => {
    expect(metric).toContain('flex-1')
  })

  it('centres the whole cluster rather than the number alone', () => {
    // icon, label, value and hint are one group inside one centring container;
    // centring the number by itself would leave the label orbiting it.
    expect(metric).toContain('flex-col justify-center')
  })

  it('pads evenly, instead of adding to the top only', () => {
    // The original imbalance: `pt-6` over the card's own even padding, with
    // nothing to match it at the bottom.
    expect(metric).not.toMatch(/className="[^"]*\bpt-6\b/)
  })

  it('sets no height that a two-line label could not fit in', () => {
    expect(metric).not.toMatch(/\bh-\d|\bmin-h-|\bmax-h-/)
  })

  it('hides no overflow and positions nothing absolutely', () => {
    expect(metric).not.toContain('overflow-hidden')
    expect(metric).not.toContain('absolute')
    expect(metric).not.toMatch(/\b-m[tblrxy]?-/)
  })
})

describe('the equipment card is a vertical composition', () => {
  it('stacks the ring above its legend rather than beside it', () => {
    // Side by side, the ring got half the card's width and the legend fought
    // for the rest — which on a phone is what pushed "Unusable, on hand" off
    // the edge. One arrangement at every width means no width at which two
    // layouts disagree.
    expect(equipment).toContain('flex flex-1 flex-col')
    expect(equipment).not.toMatch(/sm:flex-row/)
  })

  it('puts the donut before the legend in the document', () => {
    expect(equipment.indexOf('<DonutChart')).toBeLessThan(equipment.indexOf('<ChartLegend'))
  })

  it('holds the donut and the legend in one container', () => {
    // The group is the thing that gets positioned. Two siblings each finding
    // their own place in the body is what put the ring low in the card.
    const body = equipment.slice(equipment.indexOf('<CardContent'))
    const group = body.slice(body.indexOf('<div className="mx-auto'))
    const closes = group.indexOf('</div>')

    expect(group.slice(0, closes)).toContain('<DonutChart')
    expect(group.slice(0, closes)).toContain('<ChartLegend')
  })

  it('centres that container rather than the donut on its own', () => {
    const donut = equipment.slice(equipment.indexOf('<DonutChart'), equipment.indexOf('<ChartLegend'))
    expect(donut).not.toContain('mx-auto')

    const group = equipment.slice(equipment.indexOf('<div className="mx-auto'))
    expect(group.slice(0, group.indexOf('>'))).toContain('flex-col items-center')
  })

  it('keeps the two close enough to read as one statement', () => {
    const group = equipment.slice(equipment.indexOf('<div className="mx-auto'))
    const gap = /gap-(\d+)/.exec(group.slice(0, group.indexOf('>')))?.[1]
    expect(Number(gap)).toBeLessThanOrEqual(4)
  })

  it('draws it large enough to be the thing you look at', () => {
    const size = /size=\{(\d+)\}/.exec(equipment)?.[1]
    expect(Number(size)).toBeGreaterThanOrEqual(160)
  })

  it('lets the legend fill the group rather than centring itself inside it', () => {
    const legendUse = equipment.slice(equipment.indexOf('<ChartLegend'))
    const props = legendUse.slice(0, legendUse.indexOf('/>'))

    expect(props).toContain('w-full')
    expect(props).not.toContain('mx-auto')
  })

  it('keeps the legend to a single column at every width', () => {
    // Two columns were tried. Six lifecycle figures read as a list you go down,
    // and splitting them into two short columns made the eye jump rather than
    // scan — with no gain, since the labels were never what made the card wide.
    const legendUse = equipment.slice(equipment.indexOf('<ChartLegend'))
    expect(legendUse).not.toMatch(/grid-cols-/)
  })

  it('centres the group in whatever height the row gives the body', () => {
    // `flex-1` claims the surplus a stretched grid row hands over;
    // `justify-center` puts the composition's middle at the body's middle. On a
    // phone the grid is one column, there is no surplus, and neither does
    // anything — so mobile height stays content-driven.
    const body = equipment.slice(equipment.indexOf('<CardContent'))
    expect(body.slice(0, body.indexOf('>'))).toContain('flex flex-1 flex-col justify-center')
  })

  it('adds no spacer and no fixed height to consume the surplus', () => {
    expect(equipment).not.toMatch(/\bh-\d\d|\bmin-h-|\bflex-grow\b.*spacer/)
  })

  it('does not stretch or distort the ring to fill space', () => {
    const donut = equipment.slice(equipment.indexOf('<DonutChart'), equipment.indexOf('<ChartLegend'))
    expect(donut).not.toMatch(/w-full|h-full|flex-1|scale-/)
  })
})

describe('the mobile legend contract is intact', () => {
  it('never truncates a label', () => {
    // "Unusable, on hand" means something narrower than "Unusable". Shortening
    // it to fit would be a change to the product's vocabulary made by a layout
    // constraint.
    expect(legend).not.toContain('truncate')
  })

  it('wraps the label instead', () => {
    expect(legend).toContain('break-words')
  })

  it('keeps the hint on its own line, where it cannot push the row off the card', () => {
    expect(legend).toMatch(/hint[\s\S]*?\bblock\b/)
  })

  it('lets only the label column flex, so the value stays put at any width', () => {
    expect(legend).toContain('grid-cols-[0.5rem_minmax(0,1fr)_auto]')
  })

  it('always shows the value beside the label', () => {
    expect(legend).toContain('{format(datum.value)}')
  })

  it('sets no height that could clip a wrapped row', () => {
    expect(legend).not.toMatch(/\bh-\d|\bmax-h-|\boverflow-hidden\b/)
  })

  it('does not grow to fill its parent', () => {
    // `flex-1` was there for the old side-by-side arrangement. Stacked, it
    // would stretch the legend down the card and undo the centring above it.
    expect(legend).not.toContain('flex-1')
  })

  it('is one column unless a caller asks for more', () => {
    expect(legend).toMatch(/'grid w-full min-w-0 gap-y-2'/)
  })
})
