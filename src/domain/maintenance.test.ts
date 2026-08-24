import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import {
  ACTIVE_STATUSES,
  currentlyInService,
  isActiveStatus,
  isMaintenanceStatus,
  isOverdue,
  overCapacityWarning,
  validateQuantitySent,
} from '@/domain/maintenance'
import { MAINTENANCE_STATUSES, type MaintenanceStatus } from '@/types/maintenance'

function record(overrides: {
  id?: string
  status?: MaintenanceStatus
  quantity?: number
  expected?: Date | null
} = {}) {
  return {
    maintenance_id: overrides.id ?? 'm-1',
    status: overrides.status ?? 'sent',
    quantity_sent: overrides.quantity ?? 2,
    ...(overrides.expected ? { expected_return_at: Timestamp.fromDate(overrides.expected) } : {}),
  }
}

describe('status set', () => {
  it('holds the six documented values', () => {
    expect(MAINTENANCE_STATUSES).toEqual([
      'planned',
      'sent',
      'in_service',
      'ready',
      'returned',
      'cancelled',
    ])
  })

  it('recognises only those values', () => {
    for (const status of MAINTENANCE_STATUSES) {
      expect(isMaintenanceStatus(status)).toBe(true)
    }
    for (const invalid of ['Sent', 'repairing', '', 'in service']) {
      expect(isMaintenanceStatus(invalid), invalid).toBe(false)
    }
  })
})

describe('isActiveStatus', () => {
  it('counts equipment that has left and not come back', () => {
    expect(ACTIVE_STATUSES).toEqual(['sent', 'in_service', 'ready'])
    for (const status of ACTIVE_STATUSES) {
      expect(isActiveStatus(status)).toBe(true)
    }
  })

  it('excludes planned, because it has not gone yet', () => {
    expect(isActiveStatus('planned')).toBe(false)
  })

  it('excludes finished records', () => {
    expect(isActiveStatus('returned')).toBe(false)
    expect(isActiveStatus('cancelled')).toBe(false)
  })
})

describe('currentlyInService', () => {
  it('is zero with no records', () => {
    expect(currentlyInService([])).toBe(0)
  })

  it('sums only active records', () => {
    const records = [
      record({ id: 'm-1', status: 'sent', quantity: 2 }),
      record({ id: 'm-2', status: 'in_service', quantity: 3 }),
      record({ id: 'm-3', status: 'ready', quantity: 1 }),
      record({ id: 'm-4', status: 'planned', quantity: 5 }),
      record({ id: 'm-5', status: 'returned', quantity: 4 }),
      record({ id: 'm-6', status: 'cancelled', quantity: 7 }),
    ]
    expect(currentlyInService(records)).toBe(6)
  })

  it('is zero when everything has come back', () => {
    expect(
      currentlyInService([
        record({ status: 'returned', quantity: 4 }),
        record({ status: 'cancelled', quantity: 2 }),
      ]),
    ).toBe(0)
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-08-24T12:00:00Z')
  const past = new Date('2026-08-20T12:00:00Z')
  const future = new Date('2026-09-01T12:00:00Z')

  it('is false without an expected return date', () => {
    expect(isOverdue(record({ status: 'sent' }), now)).toBe(false)
  })

  it('is true once the expected date has passed', () => {
    expect(isOverdue(record({ status: 'sent', expected: past }), now)).toBe(true)
  })

  it('is false while the expected date is ahead', () => {
    expect(isOverdue(record({ status: 'sent', expected: future }), now)).toBe(false)
  })

  it('is false for finished records however late', () => {
    expect(isOverdue(record({ status: 'returned', expected: past }), now)).toBe(false)
    expect(isOverdue(record({ status: 'cancelled', expected: past }), now)).toBe(false)
  })

  it('applies to planned records too, which have a date but have not gone', () => {
    expect(isOverdue(record({ status: 'planned', expected: past }), now)).toBe(true)
  })
})

describe('validateQuantitySent', () => {
  it('accepts a sensible quantity', () => {
    expect(validateQuantitySent({ quantitySent: 3, itemQuantityTotal: 10 }).valid).toBe(true)
  })

  it('accepts the whole item', () => {
    expect(validateQuantitySent({ quantitySent: 10, itemQuantityTotal: 10 }).valid).toBe(true)
  })

  it('rejects zero and negatives, because a repair of nothing is not a record', () => {
    expect(validateQuantitySent({ quantitySent: 0, itemQuantityTotal: 10 }).valid).toBe(false)
    expect(validateQuantitySent({ quantitySent: -1, itemQuantityTotal: 10 }).valid).toBe(false)
  })

  it('rejects fractions', () => {
    expect(validateQuantitySent({ quantitySent: 1.5, itemQuantityTotal: 10 }).valid).toBe(false)
  })

  it('rejects more than the item holds', () => {
    const result = validateQuantitySent({ quantitySent: 11, itemQuantityTotal: 10 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('10')
  })
})

describe('overCapacityWarning', () => {
  const existing = [
    record({ id: 'm-1', status: 'sent', quantity: 4 }),
    record({ id: 'm-2', status: 'returned', quantity: 5 }),
  ]

  it('is null while the total fits', () => {
    expect(
      overCapacityWarning({
        existingRecords: existing,
        status: 'sent',
        quantitySent: 3,
        itemQuantityTotal: 10,
      }),
    ).toBeNull()
  })

  it('is null at exactly the total', () => {
    expect(
      overCapacityWarning({
        existingRecords: existing,
        status: 'sent',
        quantitySent: 6,
        itemQuantityTotal: 10,
      }),
    ).toBeNull()
  })

  it('warns when the active sum would exceed the total', () => {
    const warning = overCapacityWarning({
      existingRecords: existing,
      status: 'sent',
      quantitySent: 8,
      itemQuantityTotal: 10,
    })

    expect(warning).not.toBeNull()
    expect(warning?.inService).toBe(12)
    expect(warning?.quantityTotal).toBe(10)
    expect(warning?.message).toContain('12 of 10')
  })

  it('ignores finished records in the existing total', () => {
    expect(
      overCapacityWarning({
        existingRecords: [record({ id: 'm-1', status: 'returned', quantity: 9 })],
        status: 'sent',
        quantitySent: 9,
        itemQuantityTotal: 10,
      }),
    ).toBeNull()
  })

  it('does not warn when the new record is not active itself', () => {
    expect(
      overCapacityWarning({
        existingRecords: existing,
        status: 'planned',
        quantitySent: 50,
        itemQuantityTotal: 10,
      }),
    ).toBeNull()
  })

  it('excludes the record being edited, so its quantity is not counted twice', () => {
    const withoutExclusion = overCapacityWarning({
      existingRecords: existing,
      status: 'sent',
      quantitySent: 8,
      itemQuantityTotal: 10,
    })
    expect(withoutExclusion).not.toBeNull()

    const editingSameRecord = overCapacityWarning({
      existingRecords: existing,
      editingRecordId: 'm-1',
      status: 'sent',
      quantitySent: 8,
      itemQuantityTotal: 10,
    })
    expect(editingSameRecord).toBeNull()
  })

  it('still warns when an edit raises the quantity past the total', () => {
    const warning = overCapacityWarning({
      existingRecords: existing,
      editingRecordId: 'm-1',
      status: 'sent',
      quantitySent: 12,
      itemQuantityTotal: 10,
    })
    expect(warning?.inService).toBe(12)
  })
})
