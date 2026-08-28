import { describe, expect, it } from 'vitest'
import {
  MAX_LABELS_PER_PRINT, equipmentLabel, isDefaultLabelSelection, labelsForSelection,
  matchesLabelSearch, printableLabels, validateLabelSelection,
} from '@/features/inventory/equipment-label'
import { equipmentQrUrl } from '@/domain/equipment-links'
import type { InventoryUnit, UnitStatus } from '@/types/inventory'

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'unit-1',
    asset_code: 'MIC-001',
    team_id: 'team-sound',
    status: 'available',
    condition: 'good',
    storage_location: 'Booth shelf B',
    ...overrides,
  } as InventoryUnit
}

const ITEM = { name: 'Shure SM58' }
const ORG = { name: 'Riverside High Theater' }

describe('what a printed label carries', () => {
  it('carries the four things that outlive a print run', () => {
    const label = equipmentLabel({ unit: unit(), item: ITEM, organization: ORG })

    expect(label.qrUrl).toBe(equipmentQrUrl('unit-1'))
    expect(label.assetCode).toBe('MIC-001')
    expect(label.itemName).toBe('Shure SM58')
    expect(label.organizationName).toBe('Riverside High Theater')
  })

  it('carries nothing that a sticker would go on to lie about', () => {
    // The values below are all real fields of the unit this label describes.
    // A sticker printed today is read in six months; any of these could have
    // changed by then, and a confident wrong label is worse than no label.
    const label = equipmentLabel({
      unit: unit({
        status: 'in_use',
        condition: 'needs_repair',
        storage_location: 'Booth shelf B',
        using_team_id: 'team-lighting',
        notes: 'crackles on the low end',
        current_maintenance_record_id: 'repair-9',
      } as Partial<InventoryUnit>),
      item: ITEM,
      organization: ORG,
    })

    const printed = JSON.stringify(label).toLowerCase()
    for (const moving of [
      'in_use', 'needs_repair', 'booth shelf', 'team-lighting', 'crackles', 'repair-9',
    ]) {
      expect(printed).not.toContain(moving.toLowerCase())
    }

    // And structurally: exactly the four stable fields, no extras.
    expect(Object.keys(label).sort()).toEqual(
      ['assetCode', 'itemName', 'organizationName', 'qrUrl'],
    )
  })

  it('prints the same label whatever the equipment is doing today', () => {
    const statuses: UnitStatus[] = [
      'available', 'in_use', 'in_maintenance', 'lost', 'retired',
    ]
    const labels = statuses.map(
      (status) => equipmentLabel({ unit: unit({ status }), item: ITEM, organization: ORG }),
    )

    for (const label of labels) {
      expect(label).toEqual(labels[0])
    }
  })

  it('still prints something usable when the item or organization is missing', () => {
    // A label with a blank name is a nuisance; a label that fails to print
    // leaves the equipment unlabelled, which is worse.
    const label = equipmentLabel({ unit: unit(), item: null, organization: null })

    expect(label.qrUrl).toBe(equipmentQrUrl('unit-1'))
    expect(label.assetCode).toBe('MIC-001')
    expect(label.itemName).toBe('Equipment')
    expect(label.organizationName).toBe('')
  })
})

describe('choosing what to print', () => {
  const units = [
    unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
    unit({ unit_id: 'u2', asset_code: 'MIC-002' }),
    unit({ unit_id: 'u3', asset_code: 'MIC-003', status: 'retired' }),
  ]

  it('prints one', () => {
    expect(validateLabelSelection({ units, selectedIds: ['u2'] })).toEqual({
      valid: true, unitIds: ['u2'],
    })
  })

  it('prints many', () => {
    expect(validateLabelSelection({ units, selectedIds: ['u1', 'u2', 'u3'] })).toEqual({
      valid: true, unitIds: ['u1', 'u2', 'u3'],
    })
  })

  it('collapses a unit chosen twice into one sticker', () => {
    // Two identical stickers on one microphone is a wasted label and a
    // confusing shelf.
    expect(validateLabelSelection({ units, selectedIds: ['u1', 'u1', 'u2', 'u1'] })).toEqual({
      valid: true, unitIds: ['u1', 'u2'],
    })
  })

  it('refuses to print nothing', () => {
    const result = validateLabelSelection({ units, selectedIds: [] })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('Choose')
  })

  it('refuses a unit that is not on the page', () => {
    // Guards against a stale selection surviving a refresh and printing a
    // sticker for equipment that is no longer there.
    const result = validateLabelSelection({ units, selectedIds: ['u1', 'ghost'] })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('no longer exists')
  })

  it('prints a full run of 200', () => {
    const many = Array.from(
      { length: MAX_LABELS_PER_PRINT },
      (_, index) => unit({ unit_id: `u${String(index)}` }),
    )
    const result = validateLabelSelection({
      units: many,
      selectedIds: many.map((each) => each.unit_id),
    })

    expect(result.valid).toBe(true)
    if (result.valid) expect(result.unitIds).toHaveLength(MAX_LABELS_PER_PRINT)
  })

  it('stops one past a full run', () => {
    const many = Array.from(
      { length: MAX_LABELS_PER_PRINT + 1 },
      (_, index) => unit({ unit_id: `u${String(index)}` }),
    )
    const result = validateLabelSelection({
      units: many,
      selectedIds: many.map((each) => each.unit_id),
    })

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('200')
  })

  it('counts duplicates once against the limit', () => {
    const many = Array.from(
      { length: MAX_LABELS_PER_PRINT },
      (_, index) => unit({ unit_id: `u${String(index)}` }),
    )
    const withRepeats = [...many.map((each) => each.unit_id), 'u0', 'u1', 'u2']

    expect(validateLabelSelection({ units: many, selectedIds: withRepeats }).valid).toBe(true)
  })

  it('selects by unit id, not by asset code', () => {
    // Asset codes can be renamed; the identity the QR encodes cannot.
    const renamed = [unit({ unit_id: 'u1', asset_code: 'RENAMED-999' })]
    expect(validateLabelSelection({ units: renamed, selectedIds: ['u1'] }).valid).toBe(true)
    expect(validateLabelSelection({ units: renamed, selectedIds: ['MIC-001'] }).valid).toBe(false)
  })
})

describe('which units come pre-selected', () => {
  it.each(['available', 'in_use', 'in_maintenance', 'lost'] as UnitStatus[])(
    'pre-selects equipment that is still %s',
    (status) => {
      expect(isDefaultLabelSelection(unit({ status }))).toBe(true)
    },
  )

  it('leaves retired equipment unticked', () => {
    expect(isDefaultLabelSelection(unit({ status: 'retired' }))).toBe(false)
  })

  it('still allows a retired unit to be printed on purpose', () => {
    // Its QR never stopped working, so an archive reprint stays possible.
    const retired = [unit({ unit_id: 'u3', status: 'retired' })]
    expect(validateLabelSelection({ units: retired, selectedIds: ['u3'] }).valid).toBe(true)
  })
})

describe('finding a unit in a long list', () => {
  const mic = unit({ asset_code: 'MIC-001', storage_location: 'Booth shelf B' })

  it('matches what is written on the equipment', () => {
    expect(matchesLabelSearch(mic, 'MIC-001')).toBe(true)
    expect(matchesLabelSearch(mic, 'mic')).toBe(true)
    expect(matchesLabelSearch(mic, '001')).toBe(true)
  })

  it('matches where it is kept, which is how a reprint run is usually scoped', () => {
    expect(matchesLabelSearch(mic, 'booth')).toBe(true)
    expect(matchesLabelSearch(mic, 'shelf b')).toBe(true)
  })

  it('ignores stray spaces around what was typed', () => {
    expect(matchesLabelSearch(mic, '  MIC-001  ')).toBe(true)
  })

  it('shows everything when nothing is typed', () => {
    expect(matchesLabelSearch(mic, '')).toBe(true)
    expect(matchesLabelSearch(mic, '   ')).toBe(true)
  })

  it('excludes what does not match', () => {
    expect(matchesLabelSearch(mic, 'LX-014')).toBe(false)
    expect(matchesLabelSearch(mic, 'costume')).toBe(false)
  })
})

describe('preparing a batch of labels', () => {
  function run(size: number) {
    const units = Array.from({ length: size }, (_, index) => unit({
      unit_id: `unit-${String(index)}`,
      asset_code: `MIC-${String(index).padStart(3, '0')}`,
    }))
    const selection = validateLabelSelection({
      units, selectedIds: units.map((each) => each.unit_id),
    })
    expect(selection.valid).toBe(true)
    if (!selection.valid) throw new Error('unreachable')

    const started = performance.now()
    const labels = labelsForSelection({
      units, unitIds: selection.unitIds, item: ITEM, organization: ORG,
    })
    return { units, labels, elapsed: performance.now() - started }
  }

  it.each([1, 3, 50, MAX_LABELS_PER_PRINT])(
    'prepares %i labels, each distinct and pointing where it should',
    (size) => {
      const { units, labels } = run(size)

      expect(labels).toHaveLength(size)

      // No unit gets two stickers and no sticker gets left out.
      expect(new Set(labels.map((label) => label.qrUrl)).size).toBe(size)
      expect(new Set(labels.map((label) => label.assetCode)).size).toBe(size)

      // Order is the order of the units, and each label points at its own unit.
      for (const [index, label] of labels.entries()) {
        expect(label.qrUrl).toBe(equipmentQrUrl(units[index]?.unit_id ?? ''))
        expect(label.assetCode).toBe(units[index]?.asset_code)
      }
    },
  )

  it('produces the same sheet twice for the same selection', () => {
    // A reprint has to match the labels already stuck to the equipment.
    expect(run(MAX_LABELS_PER_PRINT).labels).toEqual(run(MAX_LABELS_PER_PRINT).labels)
  })

  it('does not degrade sharply as the run grows', () => {
    // Not a benchmark — a tripwire. The point is that 200 labels costs roughly
    // 200 times one label rather than 200 squared, which is what a per-id scan
    // through the unit list would have given. The bound is loose enough to
    // survive a slow machine and tight enough to catch a quadratic path.
    const full = run(MAX_LABELS_PER_PRINT)
    expect(full.elapsed).toBeLessThan(250)
  })

  it('skips a selected id whose unit is not in hand rather than printing a blank', () => {
    const units = [unit({ unit_id: 'u1' })]
    const labels = labelsForSelection({
      units, unitIds: ['u1', 'gone'], item: ITEM, organization: ORG,
    })

    expect(labels).toHaveLength(1)
    expect(labels[0]?.qrUrl).toBe(equipmentQrUrl('u1'))
  })
})

describe('what the batch Print button hands over', () => {
  const units = [
    unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
    unit({ unit_id: 'u2', asset_code: 'MIC-002' }),
    unit({ unit_id: 'u3', asset_code: 'MIC-003' }),
  ]

  function handOver(selectedIds: string[]) {
    return printableLabels({ units, selectedIds, item: ITEM, organization: ORG })
  }

  it('hands over nothing when nothing is selected, so the button stays disabled', () => {
    // The button is disabled on exactly this: null means there is nothing to
    // print, and the click handler has nothing to call.
    expect(handOver([])).toBeNull()
  })

  it('hands over one sheet for one unit', () => {
    const labels = handOver(['u2'])
    expect(labels).toHaveLength(1)
    expect(labels?.[0]?.qrUrl).toBe(equipmentQrUrl('u2'))
  })

  it('hands over three sheets for three units, in the order they are listed', () => {
    const labels = handOver(['u1', 'u2', 'u3'])
    expect(labels?.map((label) => label.assetCode)).toEqual(['MIC-001', 'MIC-002', 'MIC-003'])
  })

  it('hands over fifty', () => {
    const many = Array.from({ length: 50 }, (_, index) => unit({ unit_id: `u${String(index)}` }))
    const labels = printableLabels({
      units: many, selectedIds: many.map((each) => each.unit_id), item: ITEM, organization: ORG,
    })

    expect(labels).toHaveLength(50)
    expect(new Set(labels?.map((label) => label.qrUrl)).size).toBe(50)
  })

  it('hands over the sheet whole, not a reference to the selection', () => {
    // The selection dialog unmounts the moment this is handed over. If the
    // labels were still bound to its state, the sheet would empty out just as
    // the browser's print dialog opened — which is the failure this replaced.
    const selected = ['u1', 'u2']
    const labels = handOver(selected)

    selected.length = 0

    expect(labels).toHaveLength(2)
    expect(labels?.[0]?.qrUrl).toBe(equipmentQrUrl('u1'))
  })

  it('keeps the unit ids intact through the handover', () => {
    const labels = handOver(['u3', 'u1'])
    // Order follows the selection, and each label still points at its own unit.
    expect(labels?.map((label) => label.qrUrl)).toEqual([
      equipmentQrUrl('u3'), equipmentQrUrl('u1'),
    ])
  })

  it('refuses more than a full run rather than silently trimming it', () => {
    const many = Array.from(
      { length: MAX_LABELS_PER_PRINT + 1 },
      (_, index) => unit({ unit_id: `u${String(index)}` }),
    )
    expect(printableLabels({
      units: many, selectedIds: many.map((each) => each.unit_id), item: ITEM, organization: ORG,
    })).toBeNull()
  })
})
