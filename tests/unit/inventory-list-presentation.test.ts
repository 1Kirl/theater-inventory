import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { conditionTone } from '@/domain/status-tone'
import { itemPresentation } from '@/features/inventory/inventory-unit-view'
import { statusBadgeVariants } from '@/components/ui/status-badge'
import { cn } from '@/lib/utils'
import { CONDITION_KEYS } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'

/**
 * What the inventory list says, and where it says it.
 *
 * Two things were wrong. "Individual Equipment" sat in the Location column,
 * answering a question nobody asks of that column — how an item is tracked is
 * part of what it is, not where it is kept. And a condition was carried by a
 * six-pixel dot on an otherwise colourless chip, which was a deliberate choice
 * to keep the two colour axes apart but asked more of one dot than a table
 * column can give.
 *
 * The dot stays, because it is what still separates "Good" from "Available".
 * The chip around it now carries the same tone, so the condition is legible
 * before it is read.
 */

const page = readFileSync(
  new URL('../../src/features/inventory/InventoryListPage.tsx', import.meta.url), 'utf8',
)

function item(trackingMode: 'bulk' | 'serialized'): InventoryItem {
  return { tracking_mode: trackingMode } as unknown as InventoryItem
}

describe('how an item is tracked belongs to its identity', () => {
  it('labels a serialized item', () => {
    expect(itemPresentation(item('serialized')).badge).toBe('Individual Equipment')
  })

  it('adds nothing to a bulk item, which needs no label to be understood', () => {
    expect(itemPresentation(item('bulk')).badge).toBeNull()
  })

  it('renders the label in the name cell', () => {
    const table = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'))
    const nameCell = table.slice(
      table.indexOf('<TableCell className="font-medium">'), table.indexOf('{item.category}'),
    )

    expect(nameCell).toContain('itemPresentation(item).badge')
  })

  it('renders it as muted metadata, not as a badge or a status', () => {
    const table = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'))
    const nameCell = table.slice(
      table.indexOf('<TableCell className="font-medium">'), table.indexOf('{item.category}'),
    )

    expect(nameCell).toContain('text-muted-foreground')
    expect(nameCell).not.toContain('<Badge')
    expect(nameCell).not.toContain('StatusBadge')
  })

  it('gives the mobile card the same hierarchy as the table', () => {
    // Fixing one view and leaving the other means the two disagree about what a
    // column means, which is worse than both being wrong the same way.
    const mobile = page.slice(page.indexOf('Mobile: cards'))
    const identity = mobile.slice(0, mobile.indexOf('{item.category}'))

    expect(identity).toContain('{item.name}')
    expect(identity).toContain('itemPresentation(item).badge')
  })
})

describe('location is location', () => {
  it('never presents the tracking mode as a location', () => {
    const table = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'))
    const locationCell = table.slice(table.indexOf('showsParentLocation'))
    const cellEnd = locationCell.indexOf('</TableCell>')

    expect(locationCell.slice(0, cellEnd)).not.toContain('badge')
  })

  it('shows the real location when the item has one', () => {
    const table = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'))
    expect(table).toContain('showsParentLocation ? item.location')
  })

  it('says not-applicable for a serialized parent, which has no single one', () => {
    expect(itemPresentation(item('serialized')).showsParentLocation).toBe(false)

    const table = page.slice(page.indexOf('<TableBody>'), page.indexOf('</TableBody>'))
    const locationCell = table.slice(table.indexOf('showsParentLocation'))
    // The same em dash Team and Last inspected already use, for the same reason.
    expect(locationCell.slice(0, locationCell.indexOf('</TableCell>'))).toContain('—')
  })

  it('keeps a bulk item reading its own location', () => {
    expect(itemPresentation(item('bulk')).showsParentLocation).toBe(true)
  })
})

describe('the condition pill carries its condition', () => {
  it.each([...CONDITION_KEYS])('%s keeps its semantic tone', (condition) => {
    // The mapping is the meaning. Restyling the chip must not have touched it.
    const expected = {
      excellent: 'positive', good: 'ready', fair: 'warning',
      needs_repair: 'caution', unusable: 'danger',
    }[condition]

    expect(conditionTone(condition)).toBe(expected)
  })

  /**
   * Composed through `cn` exactly as the component does.
   *
   * cva concatenates; tailwind-merge is what resolves two `bg-*` classes into
   * the one that actually paints. Asserting on the raw cva string would pass
   * even with a neutralising class appended after the tone — which is precisely
   * the state being guarded against.
   */
  const rendered = (tone: 'caution' | 'danger' | 'warning') =>
    cn(statusBadgeVariants({ tone, shape: 'dot' }))

  it('fills and outlines the chip in the tone, rather than leaving it neutral', () => {
    const dot = rendered('caution')

    expect(dot).toContain('bg-tone-caution/10')
    expect(dot).toContain('border-tone-caution/25')
    expect(dot).toContain('text-tone-caution')
  })

  it('no longer neutralises the chip', () => {
    const dot = rendered('danger')

    expect(dot).not.toContain('bg-transparent')
    expect(dot).not.toContain('border-border')
    expect(dot).not.toContain('text-foreground')
  })

  it('still differs from a lifecycle pill, so the two axes stay apart', () => {
    const badge = readFileSync(
      new URL('../../src/components/ui/status-badge.tsx', import.meta.url), 'utf8',
    )
    // The marker is what carries that distinction now.
    expect(badge).toContain("shape === 'dot' ?")
    expect(badge).toContain('rounded-full')
  })

  it('never wraps, so "Needs Repair" cannot be broken across lines', () => {
    expect(rendered('caution')).toContain('whitespace-nowrap')
  })

  it('leaves dark mode its own stronger fill and nothing from light', () => {
    const dot = rendered('warning')

    // One token per tone, defined per theme — a light-only literal here is how
    // the two palettes would drift apart.
    expect(dot).toContain('dark:bg-tone-warning/18')
    expect(dot).not.toMatch(/oklch|#[0-9a-f]{3,6}/i)
  })
})

describe('the list is a surface, not rows loose on the page', () => {
  it('puts the table on a card', () => {
    const desktop = page.slice(page.indexOf('Desktop: a table'), page.indexOf('Mobile: cards'))

    expect(desktop).toContain('<Card')
    expect(desktop).toContain('<Table>')
    expect(desktop.indexOf('<Card')).toBeLessThan(desktop.indexOf('<Table>'))
  })

  it('uses the shared card rather than a private surface for the list', () => {
    const desktop = page.slice(page.indexOf('Desktop: a table'), page.indexOf('Mobile: cards'))
    expect(desktop).not.toMatch(/bg-white|bg-\[#|rounded-\[/)
  })

  it('keeps the card out of the way on mobile, where rows are already cards', () => {
    const desktop = page.slice(page.indexOf('Desktop: a table'), page.indexOf('Mobile: cards'))
    expect(desktop).toContain('hidden md:block')
  })
})
