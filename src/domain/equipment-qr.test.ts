import { describe, expect, it } from 'vitest'
import { parseEquipmentQr } from '@/domain/equipment-qr'
import { equipmentQrUrl, publicAppOrigin } from '@/domain/equipment-links'

const CANONICAL = 'https://theater-inventory.web.app'

describe('reading one of our own labels', () => {
  it('reads back exactly what the generator wrote', () => {
    // The round trip is the contract. If these two ever disagree, every label
    // already stuck to equipment stops scanning.
    for (const unitId of ['unit-1', 'aBc123XYZ', 'unitLIGHTINGAAAAAAAA']) {
      expect(parseEquipmentQr(equipmentQrUrl(unitId))).toBe(unitId)
    }
  })

  it('reads a canonical URL written by hand', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-123`)).toBe('unit-123')
  })

  it('decodes a percent-encoded unit id', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit%2D123`)).toBe('unit-123')
    expect(parseEquipmentQr(`${CANONICAL}/equipment/a%20b`)).toBe('a b')
  })

  it('ignores whitespace around the scanned value', () => {
    expect(parseEquipmentQr(`  ${CANONICAL}/equipment/unit-1  `)).toBe('unit-1')
  })

  it('reads a production label while the app runs on localhost', () => {
    // The whole reason the origin is a constant rather than window.location:
    // labels in the storage room point at the deployed site, and a scanner
    // opened during development has to recognise them.
    expect(publicAppOrigin()).toBe(CANONICAL)
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-1`)).toBe('unit-1')
  })

  it('tolerates a trailing slash on the configured origin', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-1`, `${CANONICAL}/`)).toBe('unit-1')
  })
})

describe('what a camera must refuse', () => {
  it.each([
    ['a different site entirely', 'https://example.com/equipment/unit-1'],
    ['a lookalike suffix', 'https://theater-inventory.web.app.evil.example/equipment/unit-1'],
    ['a lookalike prefix', 'https://evil-theater-inventory.web.app/equipment/unit-1'],
    ['a subdomain of the real host', 'https://a.theater-inventory.web.app/equipment/unit-1'],
    ['a different TLD', 'https://theater-inventory.web.app.co/equipment/unit-1'],
    ['a hostname that merely contains ours', 'https://x.com/theater-inventory.web.app/equipment/u'],
  ])('refuses %s', (_label, value) => {
    // Exact host equality is what does this. Anything looser would let somebody
    // print a sticker that scans as ours.
    expect(parseEquipmentQr(value)).toBeNull()
  })

  it('refuses http, which no genuine label uses', () => {
    expect(parseEquipmentQr('http://theater-inventory.web.app/equipment/unit-1')).toBeNull()
  })

  it('refuses embedded credentials', () => {
    expect(parseEquipmentQr('https://user:pass@theater-inventory.web.app/equipment/unit-1'))
      .toBeNull()
  })

  it.each([
    ['the inventory item page', `${CANONICAL}/inventory/item-1`],
    ['the dashboard', `${CANONICAL}/`],
    ['a deeper path', `${CANONICAL}/equipment/unit-1/edit`],
    ['a shallower path', `${CANONICAL}/equipment`],
    ['equipment with no id', `${CANONICAL}/equipment/`],
    ['a near-miss segment', `${CANONICAL}/equipments/unit-1`],
    ['the maintenance page', `${CANONICAL}/maintenance/rec-1`],
  ])('refuses %s', (_label, value) => {
    expect(parseEquipmentQr(value)).toBeNull()
  })

  it('refuses a query string or a fragment', () => {
    // Nothing we generate carries either, so their presence means the value came
    // from somewhere else. Refused rather than trimmed down to look right.
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-1?utm=x`)).toBeNull()
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-1#frag`)).toBeNull()
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-1?`)).toBe('unit-1')
  })

  it.each([
    ['plain text', 'hello world'],
    ['a bare unit id', 'unit-123'],
    ['an asset code', 'MIC-017'],
    ['a wifi QR', 'WIFI:S:Theater;T:WPA;P:secret;;'],
    ['a phone number', 'tel:+15551234567'],
    ['a mailto', 'mailto:someone@example.com'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>'],
    ['a protocol-relative URL', '//theater-inventory.web.app/equipment/unit-1'],
    ['a rooted path with no host', '/equipment/unit-1'],
    ['a malformed URL', 'https://'],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('refuses %s', (_label, value) => {
    expect(parseEquipmentQr(value)).toBeNull()
  })

  it('refuses anything that is not a string', () => {
    // The decoder hands back whatever it found; nothing downstream assumes.
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(parseEquipmentQr(value)).toBeNull()
    }
  })

  it('refuses a malformed percent escape rather than throwing', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/%E0%A4%A`)).toBeNull()
  })

  it('refuses an id that decodes to a path', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/a%2Fb`)).toBeNull()
    expect(parseEquipmentQr(`${CANONICAL}/equipment/a%5Cb`)).toBeNull()
  })

  it('refuses an id that decodes to nothing but whitespace', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/%20`)).toBeNull()
    expect(parseEquipmentQr(`${CANONICAL}/equipment/%09`)).toBeNull()
  })
})

describe('a deployment on its own domain', () => {
  const OTHER = 'https://labels.riverside.example.org'

  it('reads labels for the origin it was given', () => {
    expect(parseEquipmentQr(`${OTHER}/equipment/unit-1`, OTHER)).toBe('unit-1')
  })

  it('still refuses labels for a different one', () => {
    expect(parseEquipmentQr(`${CANONICAL}/equipment/unit-1`, OTHER)).toBeNull()
    expect(parseEquipmentQr(`${OTHER}/equipment/unit-1`, CANONICAL)).toBeNull()
  })
})
