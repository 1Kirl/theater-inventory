import { describe, expect, it } from 'vitest'
import { equipmentQrUrl, inventoryItemQrUrl } from '@/domain/equipment-links'
import { parseAppQr, parseEquipmentQr } from '@/domain/equipment-qr'
import { equipmentLabel, inventoryItemLabel } from '@/features/inventory/equipment-label'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'

/**
 * Two kinds of label, one parser.
 *
 * Bulk items had no QR at all, which left the most scannable thing in a storage
 * room — a bin of cable — as the one thing nobody could scan. Adding an item
 * label meant widening the parser, and widening a parser that stands between a
 * camera and a lifecycle write is where this could have gone wrong.
 *
 * So what these tests hold is that exactly one thing widened: which first path
 * segment is accepted, from one value to a closed set of two. Every other
 * refusal — host, scheme, credentials, query, fragment, segment count — is
 * asserted again here against both label types rather than assumed to have
 * survived.
 */

const ORIGIN = 'https://theater-inventory.web.app'
const UNIT_ID = 'unitAAAAAAAAAAAAAAA1'
const ITEM_ID = 'itemBBBBBBBBBBBBBBB1'

describe('the canonical URLs', () => {
  it('builds a unit link exactly as it always did', () => {
    expect(equipmentQrUrl(UNIT_ID, ORIGIN)).toBe(`${ORIGIN}/equipment/${UNIT_ID}`)
  })

  it('builds an item link under /inventory', () => {
    expect(inventoryItemQrUrl(ITEM_ID, ORIGIN)).toBe(`${ORIGIN}/inventory/${ITEM_ID}`)
  })

  it('defaults both to the deployed origin, never to wherever the app is running', () => {
    expect(equipmentQrUrl(UNIT_ID).startsWith(ORIGIN)).toBe(true)
    expect(inventoryItemQrUrl(ITEM_ID).startsWith(ORIGIN)).toBe(true)
  })

  it('does not let a trailing slash on the origin produce a double slash', () => {
    expect(inventoryItemQrUrl(ITEM_ID, `${ORIGIN}/`)).toBe(`${ORIGIN}/inventory/${ITEM_ID}`)
  })

  it('encodes the id rather than pasting it in', () => {
    expect(inventoryItemQrUrl('a b', ORIGIN)).toBe(`${ORIGIN}/inventory/a%20b`)
  })

  it('refuses to build a link with no id, rather than printing a dead one', () => {
    expect(() => inventoryItemQrUrl('  ', ORIGIN)).toThrow()
    expect(() => equipmentQrUrl('  ', ORIGIN)).toThrow()
  })

  it('round-trips both through the parser', () => {
    expect(parseAppQr(equipmentQrUrl(UNIT_ID, ORIGIN), ORIGIN))
      .toEqual({ kind: 'unit', unitId: UNIT_ID })
    expect(parseAppQr(inventoryItemQrUrl(ITEM_ID, ORIGIN), ORIGIN))
      .toEqual({ kind: 'item', itemId: ITEM_ID })
  })
})

describe('what the scanner accepts', () => {
  it('reads a production unit label as a unit', () => {
    expect(parseAppQr(`${ORIGIN}/equipment/${UNIT_ID}`, ORIGIN))
      .toEqual({ kind: 'unit', unitId: UNIT_ID })
  })

  it('reads a production item label as an item', () => {
    expect(parseAppQr(`${ORIGIN}/inventory/${ITEM_ID}`, ORIGIN))
      .toEqual({ kind: 'item', itemId: ITEM_ID })
  })

  // The whole reason the parser compares against a constant rather than
  // window.location: labels in a storage room point at production, and a
  // developer scanning one on localhost has to match them.
  it('reads a production item label while the app runs on localhost', () => {
    expect(parseAppQr(`${ORIGIN}/inventory/${ITEM_ID}`, 'http://localhost:5173'))
      .toBeNull()
    expect(parseAppQr(`${ORIGIN}/inventory/${ITEM_ID}`, ORIGIN))
      .toEqual({ kind: 'item', itemId: ITEM_ID })
  })

  it('decodes a percent-encoded id', () => {
    expect(parseAppQr(`${ORIGIN}/inventory/a%20b`, ORIGIN)).toEqual({ kind: 'item', itemId: 'a b' })
  })
})

describe('what the scanner still refuses', () => {
  const refused: [string, unknown][] = [
    ['a lookalike host', `https://theater-inventory.web.app.evil.example/inventory/${ITEM_ID}`],
    ['a different TLD', `https://theater-inventory.web.app.co/inventory/${ITEM_ID}`],
    ['a subdomain', `https://x.theater-inventory.web.app/inventory/${ITEM_ID}`],
    ['an unrelated host', `https://example.com/inventory/${ITEM_ID}`],
    ['http rather than https', `http://theater-inventory.web.app/inventory/${ITEM_ID}`],
    ['embedded credentials', `https://user:pw@theater-inventory.web.app/inventory/${ITEM_ID}`],
    ['a query string', `${ORIGIN}/inventory/${ITEM_ID}?utm=1`],
    ['a fragment', `${ORIGIN}/inventory/${ITEM_ID}#x`],
    ['a third segment', `${ORIGIN}/inventory/${ITEM_ID}/edit`],
    ['one segment', `${ORIGIN}/inventory`],
    ['an unrelated page on our own host', `${ORIGIN}/productions/${ITEM_ID}`],
    ['the dashboard', `${ORIGIN}/`],
    ['an empty id', `${ORIGIN}/inventory/`],
    ['a malformed percent escape', `${ORIGIN}/inventory/%E0%A4%A`],
    ['a bare id with no URL around it', ITEM_ID],
    ['a sentence', 'Cannon XLR cable, 20 of them'],
    ['nothing at all', ''],
    ['a non-string', 42],
    ['a javascript: URL', 'javascript:alert(1)'],
  ]

  it.each(refused)('refuses %s', (_name, value) => {
    expect(parseAppQr(value, ORIGIN)).toBeNull()
  })

  // /inventory/new and /inventory/scan are pages, not records. They fit the
  // shape a label has, so they are named rather than left to chance.
  it.each(['new', 'scan'])('refuses the /inventory/%s route, which is a page', (segment) => {
    expect(parseAppQr(`${ORIGIN}/inventory/${segment}`, ORIGIN)).toBeNull()
  })

  it('refuses a path separator smuggled through an escape', () => {
    expect(parseAppQr(`${ORIGIN}/inventory/a%2Fb`, ORIGIN)).toBeNull()
  })
})

describe('the unit-only parser', () => {
  it('still reads a unit label', () => {
    expect(parseEquipmentQr(`${ORIGIN}/equipment/${UNIT_ID}`, ORIGIN)).toBe(UNIT_ID)
  })

  it('refuses an item label rather than returning an item id as a unit id', () => {
    expect(parseEquipmentQr(`${ORIGIN}/inventory/${ITEM_ID}`, ORIGIN)).toBeNull()
  })

  it('refuses everything it refused before', () => {
    expect(parseEquipmentQr(`https://example.com/equipment/${UNIT_ID}`, ORIGIN)).toBeNull()
    expect(parseEquipmentQr(`${ORIGIN}/equipment/${UNIT_ID}?a=1`, ORIGIN)).toBeNull()
    expect(parseEquipmentQr(UNIT_ID, ORIGIN)).toBeNull()
  })
})

describe('what a printed label says', () => {
  const organization = { name: 'Ridgeview High School Theater' }

  function item(trackingMode: 'bulk' | 'serialized'): InventoryItem {
    return {
      item_id: ITEM_ID,
      name: 'Cannon XLR Cable',
      tracking_mode: trackingMode,
    } as unknown as InventoryItem
  }

  it('names a bulk item as a bulk item', () => {
    const label = inventoryItemLabel({ item: item('bulk'), organization })

    expect(label.qrUrl).toBe(`${ORIGIN}/inventory/${ITEM_ID}`)
    expect(label.assetCode).toBe('Bulk item')
    expect(label.itemName).toBe('Cannon XLR Cable')
    expect(label.organizationName).toBe('Ridgeview High School Theater')
  })

  it('names a serialized parent as an item, not a bulk one', () => {
    expect(inventoryItemLabel({ item: item('serialized'), organization }).assetCode).toBe('Item')
  })

  it('carries no quantity, because quantity is the fastest thing to go stale', () => {
    const label = inventoryItemLabel({ item: item('bulk'), organization })
    expect(JSON.stringify(label)).not.toMatch(/\d+\s*(units?|pieces?|qty)/i)
  })

  it('puts nothing but the URL in the code', () => {
    expect(inventoryItemLabel({ item: item('bulk'), organization }).qrUrl)
      .toBe(`${ORIGIN}/inventory/${ITEM_ID}`)
  })

  it('leaves the unit label untouched', () => {
    const unit = { unit_id: UNIT_ID, asset_code: 'MIC-017' } as unknown as InventoryUnit
    const label = equipmentLabel({ unit, item: { name: 'Wireless Microphone' }, organization })

    expect(label.qrUrl).toBe(`${ORIGIN}/equipment/${UNIT_ID}`)
    expect(label.assetCode).toBe('MIC-017')
  })
})
