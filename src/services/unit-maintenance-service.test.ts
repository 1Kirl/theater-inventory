import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS } from '@/domain/inventory'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'

/**
 * What a serialized repair actually writes.
 *
 * One transaction for the whole batch: every unit, the parent's counts, the
 * record, and a single shared event. The Rules tests prove what Firestore will
 * accept; these prove the service sends that shape and nothing else.
 */

const auth = { currentUser: { uid: 'uid-actor' } as { uid: string } | null }

let allocatedIds: string[] = []
let idCounter = 0

interface Attempt {
  reads: string[]
  writes: { path: string; data: Record<string, unknown> }[]
}

let attempts: Attempt[] = []
let attemptsToRun = 1
let looseWrites: string[] = []

let STORED_UNITS: Record<string, InventoryUnit> = {}
let STORED_ITEM: InventoryItem
let STORED_RECORD: MaintenanceRecord

vi.mock('@/lib/firebase', () => ({
  getFirebaseAuth: () => auth,
  getFirebaseDb: () => ({ __db: true }),
}))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()

  return {
    ...actual,
    collection: (_db: unknown, name: string) => ({ __collection: name }),
    doc: (parent: { __collection?: string; __db?: boolean }, name?: string, id?: string) => {
      if (parent.__collection) {
        idCounter += 1
        const generated = `generated-${String(idCounter)}`
        allocatedIds.push(generated)
        return { id: generated, path: `${parent.__collection}/${generated}` }
      }
      return { id: id as string, path: `${name as string}/${id as string}` }
    },
    serverTimestamp: () => '<server-timestamp>',
    setDoc: (ref: { path: string }) => {
      looseWrites.push(ref.path)
      return Promise.resolve()
    },
    runTransaction: async (_db: unknown, body: (transaction: unknown) => Promise<void>) => {
      for (let run = 0; run < attemptsToRun; run += 1) {
        const attempt: Attempt = { reads: [], writes: [] }
        attempts.push(attempt)

        await body({
          get: (ref: { path: string }) => {
            if (attempt.writes.length > 0) {
              throw new Error(`read after write in a transaction: ${ref.path}`)
            }
            attempt.reads.push(ref.path)

            if (ref.path.startsWith('inventory_units/')) {
              const id = ref.path.split('/')[1] as string
              const unit = STORED_UNITS[id]
              return Promise.resolve({ exists: () => Boolean(unit), data: () => unit })
            }
            if (ref.path.startsWith('maintenance_records/')) {
              return Promise.resolve({ exists: () => true, data: () => STORED_RECORD })
            }
            return Promise.resolve({ exists: () => true, data: () => STORED_ITEM })
          },
          set: (ref: { path: string }, data: Record<string, unknown>) => {
            attempt.writes.push({ path: ref.path, data })
          },
        })
      }
    },
  }
})

const {
  cancelMaintenancePlan, planUnitsForMaintenance, sendUnitsToMaintenance,
  startPlannedMaintenance, updateMaintenancePlan, updateSerializedMaintenance,
} = await import('@/services/unit-maintenance-service')

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'u1',
    organization_id: 'org-1',
    inventory_item_id: 'item-1',
    team_id: 'team-lighting',
    asset_code: 'CLAMP-001',
    condition: 'good',
    status: 'available',
    storage_location: 'Storage',
    created_by_uid: 'uid-admin',
    created_at: Timestamp.fromMillis(1_000),
    updated_at: Timestamp.fromMillis(1_000),
    ...overrides,
  } as InventoryUnit
}

const ITEM: InventoryItem = {
  item_id: 'item-1',
  organization_id: 'org-1',
  team_id: 'team-lighting',
  name: 'C-Clamp',
  category: 'Hardware',
  tracking_mode: 'serialized',
  unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 3, available: 3 },
  quantity_total: 3,
  quantity_available: 3,
  condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 3 },
  location: 'Storage',
  created_by_uid: 'uid-admin',
  created_at: Timestamp.fromMillis(1_000),
  updated_at: Timestamp.fromMillis(1_000),
} as InventoryItem

const INPUT = { issueDescription: 'Threads stripped', serviceProviderName: 'Ace Repairs' }

function writesTo(attempt: Attempt | undefined, prefix: string) {
  return attempt?.writes.filter((write) => write.path.startsWith(prefix)) ?? []
}

function three() {
  return [unit({ unit_id: 'u1' }), unit({ unit_id: 'u2' }), unit({ unit_id: 'u3' })]
}

beforeEach(() => {
  allocatedIds = []
  idCounter = 0
  attempts = []
  attemptsToRun = 1
  looseWrites = []
  auth.currentUser = { uid: 'uid-actor' }
  STORED_ITEM = ITEM
  STORED_UNITS = Object.fromEntries(three().map((one) => [one.unit_id, one]))
  STORED_RECORD = {
    maintenance_id: 'rec-1',
    organization_id: 'org-1',
    item_id: 'item-1',
    team_id: 'team-lighting',
    tracking_mode: 'serialized',
    unit_ids: ['u1', 'u2', 'u3'],
    quantity_sent: 3,
    issue_description: 'Threads stripped',
    status: 'sent',
    created_by_uid: 'uid-admin',
    created_at: Timestamp.fromMillis(1_000),
    updated_at: Timestamp.fromMillis(1_000),
  } as MaintenanceRecord
})

describe('sending equipment for repair', () => {
  it('writes every unit, the parent, the record, and one shared event', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    expect(attempts).toHaveLength(1)
    expect(writesTo(attempts[0], 'inventory_units/')).toHaveLength(3)
    expect(writesTo(attempts[0], 'inventory_items/')).toHaveLength(1)
    expect(writesTo(attempts[0], 'maintenance_records/')).toHaveLength(1)
    // One event for the batch, not one per unit — that is what keeps a
    // fifty-clamp repair inside the Rules access-call budget.
    expect(writesTo(attempts[0], 'asset_events/')).toHaveLength(1)
  })

  it('points every unit at the same event and the same record', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    const units = writesTo(attempts[0], 'inventory_units/')
    const eventId = writesTo(attempts[0], 'asset_events/')[0]?.path.split('/')[1]
    const recordId = writesTo(attempts[0], 'maintenance_records/')[0]?.path.split('/')[1]

    for (const write of units) {
      expect(write.data.last_lifecycle_event_id).toBe(eventId)
      expect(write.data.current_maintenance_record_id).toBe(recordId)
      expect(write.data.status).toBe('in_maintenance')
    }
  })

  it('starts a serialized repair at sent, never planned', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    const record = writesTo(attempts[0], 'maintenance_records/')[0]?.data
    expect(record?.status).toBe('sent')
    expect(record?.tracking_mode).toBe('serialized')
    expect(record?.unit_ids).toEqual(['u1', 'u2', 'u3'])
    expect(record?.quantity_sent).toBe(3)
  })

  it('records the visit on each unit', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    const recordId = writesTo(attempts[0], 'maintenance_records/')[0]?.path.split('/')[1]
    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.maintenance_record_ids).toEqual([recordId])
    }
  })

  it('appends to a unit that has been repaired before', async () => {
    STORED_UNITS.u1 = unit({ unit_id: 'u1', maintenance_record_ids: ['rec-earlier'] })

    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    const recordId = writesTo(attempts[0], 'maintenance_records/')[0]?.path.split('/')[1]
    const first = writesTo(attempts[0], 'inventory_units/')
      .find((write) => write.path.endsWith('/u1'))

    expect(first?.data.maintenance_record_ids).toEqual(['rec-earlier', recordId])
  })

  it('takes the units out of the parent availability', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    const parent = writesTo(attempts[0], 'inventory_items/')[0]?.data
    expect(parent?.unit_counts).toMatchObject({
      available: 0, in_maintenance: 3, active_total: 3,
    })
    expect(parent?.quantity_available).toBe(0)
    // Away for repair is still the organization's equipment.
    expect(parent?.quantity_total).toBe(3)
  })

  it('reads everything before writing anything', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    expect(attempts[0]?.reads[0]).toBe('inventory_items/item-1')
    expect(attempts[0]?.reads).toHaveLength(4)
  })

  it('makes no write outside the transaction', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })
    expect(looseWrites).toEqual([])
  })

  it('refuses a unit that stopped being available while the page was open', async () => {
    STORED_UNITS.u2 = unit({ unit_id: 'u2', status: 'in_use', using_team_id: 'team-costume' })

    await expect(sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT }))
      .rejects.toThrow(/no longer available/i)
  })

  it('refuses a bulk item, before any write', async () => {
    await expect(sendUnitsToMaintenance({
      item: { ...ITEM, tracking_mode: 'bulk' } as InventoryItem, units: three(), input: INPUT,
    })).rejects.toThrow(/quantity rather than individual/i)

    expect(attempts).toEqual([])
  })

  it('refuses an empty selection', async () => {
    await expect(sendUnitsToMaintenance({ item: ITEM, units: [], input: INPUT }))
      .rejects.toThrow(/choose the equipment/i)
  })

  it('refuses more than one repair can carry', async () => {
    const many = Array.from({ length: 201 }, (_, index) => unit({ unit_id: `u${String(index)}` }))

    await expect(sendUnitsToMaintenance({ item: ITEM, units: many, input: INPUT }))
      .rejects.toThrow(/at most 200/i)

    expect(attempts).toEqual([])
  })
})

describe('recording a repair that is already under way', () => {
  it.each(['sent', 'in_service', 'ready'] as const)(
    'creates the record at %s',
    async (status) => {
      await sendUnitsToMaintenance({ item: ITEM, units: three(), status, input: INPUT })

      expect(writesTo(attempts[0], 'maintenance_records/')[0]?.data.status).toBe(status)
    },
  )

  it.each(['in_service', 'ready'] as const)(
    'moves the equipment out exactly once when created at %s',
    async (status) => {
      // Whichever stage is recorded, a clamp only knows it is at the shop.
      // There is no intermediate Sent record for the user to advance past.
      await sendUnitsToMaintenance({ item: ITEM, units: three(), status, input: INPUT })

      const units = writesTo(attempts[0], 'inventory_units/')
      expect(units).toHaveLength(3)
      for (const write of units) {
        expect(write.data.status).toBe('in_maintenance')
        expect(write.data.current_maintenance_record_id).toBeDefined()
        expect((write.data.maintenance_record_ids as string[]).length).toBe(1)
      }

      expect(writesTo(attempts[0], 'inventory_items/')[0]?.data.unit_counts)
        .toMatchObject({ available: 0, in_maintenance: 3 })
    },
  )

  it.each(['in_service', 'ready'] as const)(
    'still writes one shared entry-into-maintenance event at %s',
    async (status) => {
      await sendUnitsToMaintenance({ item: ITEM, units: three(), status, input: INPUT })

      const events = writesTo(attempts[0], 'asset_events/')
      expect(events).toHaveLength(1)
      // One lifecycle transition happened, whatever the paperwork says.
      expect(events[0]?.data.event_type).toBe('sent_to_maintenance')
      expect(events[0]?.data.from_status).toBe('available')
      expect(events[0]?.data.to_status).toBe('in_maintenance')
    },
  )

  it('defaults to sent when no stage is given', async () => {
    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    expect(writesTo(attempts[0], 'maintenance_records/')[0]?.data.status).toBe('sent')
  })

  it('refuses to send equipment on a record that is only planned', async () => {
    // Planning goes through its own path, which moves nothing.
    await expect(sendUnitsToMaintenance({
      item: ITEM, units: three(), status: 'planned', input: INPUT,
    })).rejects.toThrow(/create it as planned instead/i)

    expect(attempts).toEqual([])
  })

  it.each(['returned', 'cancelled'] as const)(
    'refuses to record a repair as %s',
    async (status) => {
      await expect(sendUnitsToMaintenance({
        item: ITEM, units: three(), status, input: INPUT,
      })).rejects.toThrow(/sent, in service, or ready/i)

      expect(attempts).toEqual([])
    },
  )
})

describe('retry behaviour', () => {
  it('reuses one record id and one event id when the transaction runs again', async () => {
    attemptsToRun = 2

    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    // Two ids for the whole operation — the record and the event — not two per
    // attempt. A retry that generated fresh ones would file a second repair.
    expect(allocatedIds).toHaveLength(2)
    expect(attempts[1]?.writes.map((write) => write.path))
      .toEqual(attempts[0]?.writes.map((write) => write.path))
  })

  it('recomputes the same parent counts on a retry', async () => {
    attemptsToRun = 2

    await sendUnitsToMaintenance({ item: ITEM, units: three(), input: INPUT })

    expect(writesTo(attempts[1], 'inventory_items/')[0]?.data)
      .toEqual(writesTo(attempts[0], 'inventory_items/')[0]?.data)
  })
})

describe('moving a repair along', () => {
  beforeEach(() => {
    STORED_UNITS = Object.fromEntries(
      three().map((one) => [one.unit_id, {
        ...one,
        status: 'in_maintenance',
        current_maintenance_record_id: 'rec-1',
        maintenance_record_ids: ['rec-1'],
      } as InventoryUnit]),
    )
    STORED_ITEM = {
      ...ITEM,
      unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 3, in_maintenance: 3 },
      quantity_available: 0,
    } as InventoryItem
  })

  it('writes only the record for a workflow step', async () => {
    // Sent to in service is paperwork; the equipment has not moved.
    await updateSerializedMaintenance({
      record: STORED_RECORD, to: 'in_service', input: INPUT,
    })

    expect(writesTo(attempts[0], 'maintenance_records/')).toHaveLength(1)
    expect(writesTo(attempts[0], 'inventory_units/')).toHaveLength(0)
    expect(writesTo(attempts[0], 'asset_events/')).toHaveLength(0)
    expect(writesTo(attempts[0], 'inventory_items/')).toHaveLength(0)
  })

  it('brings the whole batch home on return', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'ready' }

    await updateSerializedMaintenance({ record: STORED_RECORD, to: 'returned', input: INPUT })

    expect(writesTo(attempts[0], 'inventory_units/')).toHaveLength(3)
    expect(writesTo(attempts[0], 'asset_events/')).toHaveLength(1)
    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.status).toBe('available')
      expect(write.data.current_maintenance_record_id).toBeUndefined()
    }
  })

  it('keeps the repair on each unit after it comes back', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'ready' }

    await updateSerializedMaintenance({ record: STORED_RECORD, to: 'returned', input: INPUT })

    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.maintenance_record_ids).toEqual(['rec-1'])
    }
  })

  it('does not touch condition on the way back', async () => {
    STORED_UNITS.u1 = {
      ...STORED_UNITS.u1, condition: 'needs_repair',
    } as InventoryUnit
    STORED_RECORD = { ...STORED_RECORD, status: 'ready' }

    await updateSerializedMaintenance({ record: STORED_RECORD, to: 'returned', input: INPUT })

    const first = writesTo(attempts[0], 'inventory_units/')
      .find((write) => write.path.endsWith('/u1'))

    // Coming back from the shop is not a claim that it was fixed.
    expect(first?.data.condition).toBe('needs_repair')
  })

  it('brings the batch home on cancellation too', async () => {
    await updateSerializedMaintenance({ record: STORED_RECORD, to: 'cancelled', input: INPUT })

    expect(writesTo(attempts[0], 'inventory_units/')).toHaveLength(3)
    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.status).toBe('available')
    }
  })

  it('returns the units to the parent availability', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'ready' }

    await updateSerializedMaintenance({ record: STORED_RECORD, to: 'returned', input: INPUT })

    expect(writesTo(attempts[0], 'inventory_items/')[0]?.data.unit_counts)
      .toMatchObject({ available: 3, in_maintenance: 0 })
  })

  it('refuses to plan a serialized repair', async () => {
    await expect(updateSerializedMaintenance({
      record: STORED_RECORD, to: 'planned', input: INPUT,
    })).rejects.toThrow(/cannot be planned/i)

    expect(attempts).toEqual([])
  })

  it('refuses to reopen a finished repair', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'returned' }

    await expect(updateSerializedMaintenance({
      record: STORED_RECORD, to: 'sent', input: INPUT,
    })).rejects.toThrow(/finished/i)
  })

  it('refuses a bulk record', async () => {
    await expect(updateSerializedMaintenance({
      record: { ...STORED_RECORD, tracking_mode: 'bulk' } as MaintenanceRecord,
      to: 'in_service', input: INPUT,
    })).rejects.toThrow(/quantity rather than individual/i)
  })

  it('refuses when a unit is no longer at the repair shop', async () => {
    STORED_UNITS.u2 = { ...STORED_UNITS.u2, status: 'available' } as InventoryUnit
    STORED_RECORD = { ...STORED_RECORD, status: 'ready' }

    await expect(updateSerializedMaintenance({
      record: STORED_RECORD, to: 'returned', input: INPUT,
    })).rejects.toThrow(/not at the repair shop/i)
  })

  it('refuses when somebody else moved the repair first', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'returned' }

    await expect(updateSerializedMaintenance({
      record: { ...STORED_RECORD, status: 'ready' } as MaintenanceRecord,
      to: 'returned',
      input: INPUT,
    })).rejects.toThrow(/moved this repair while this page was open/i)
  })

  it('reuses one event id across a retried return', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'ready' }
    attemptsToRun = 2

    await updateSerializedMaintenance({ record: STORED_RECORD, to: 'returned', input: INPUT })

    expect(allocatedIds).toHaveLength(1)
  })
})

describe('planning a repair moves nothing', () => {
  const PLAN_INPUT = { issueDescription: 'Crackling on channel 2' }

  it('writes the plan and a pointer on each unit, and nothing else', async () => {
    await planUnitsForMaintenance({ item: ITEM, units: three(), input: PLAN_INPUT })

    expect(writesTo(attempts[0], 'maintenance_records/')).toHaveLength(1)
    expect(writesTo(attempts[0], 'inventory_units/')).toHaveLength(3)
    // The three things a plan must not do.
    expect(writesTo(attempts[0], 'inventory_items/')).toHaveLength(0)
    expect(writesTo(attempts[0], 'asset_events/')).toHaveLength(0)
    expect(looseWrites).toEqual([])
  })

  it('records the plan as planned', async () => {
    await planUnitsForMaintenance({ item: ITEM, units: three(), input: PLAN_INPUT })

    const record = writesTo(attempts[0], 'maintenance_records/')[0]?.data
    expect(record?.status).toBe('planned')
    expect(record?.tracking_mode).toBe('serialized')
    expect(record?.unit_ids).toEqual(['u1', 'u2', 'u3'])
  })

  it('leaves every unit exactly where it was', async () => {
    await planUnitsForMaintenance({ item: ITEM, units: three(), input: PLAN_INPUT })

    const planId = writesTo(attempts[0], 'maintenance_records/')[0]?.path.split('/')[1]
    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.status).toBe('available')
      expect(write.data.planned_maintenance_record_id).toBe(planId)
      // None of the things that happen when equipment actually leaves.
      expect(write.data.current_maintenance_record_id).toBeUndefined()
      expect(write.data.maintenance_record_ids).toBeUndefined()
    }
  })

  it('plans equipment somebody is currently using', async () => {
    // The repair is for later; the microphone can be checked in first.
    STORED_UNITS.u2 = unit({ unit_id: 'u2', status: 'in_use', using_team_id: 'team-costume' })

    await planUnitsForMaintenance({ item: ITEM, units: three(), input: PLAN_INPUT })

    const second = writesTo(attempts[0], 'inventory_units/')
      .find((write) => write.path.endsWith('/u2'))
    expect(second?.data.status).toBe('in_use')
    expect(second?.data.using_team_id).toBe('team-costume')
  })

  it('refuses to plan equipment that is already at a repair shop', async () => {
    STORED_UNITS.u2 = unit({
      unit_id: 'u2', status: 'in_maintenance', current_maintenance_record_id: 'rec-other',
    })

    await expect(planUnitsForMaintenance({ item: ITEM, units: three(), input: PLAN_INPUT }))
      .rejects.toThrow(/already at the repair shop/i)
  })

  it('refuses to plan equipment that is already planned', async () => {
    STORED_UNITS.u2 = unit({ unit_id: 'u2', planned_maintenance_record_id: 'plan-other' })

    await expect(planUnitsForMaintenance({ item: ITEM, units: three(), input: PLAN_INPUT }))
      .rejects.toThrow(/already planned/i)
  })

  it('refuses to plan a bulk item', async () => {
    await expect(planUnitsForMaintenance({
      item: { ...ITEM, tracking_mode: 'bulk' } as InventoryItem, units: three(), input: PLAN_INPUT,
    })).rejects.toThrow(/quantity rather than individual/i)

    expect(attempts).toEqual([])
  })
})

describe('changing and calling off a plan', () => {
  const PLAN_INPUT = { issueDescription: 'Crackling on channel 2' }

  beforeEach(() => {
    STORED_RECORD = {
      ...STORED_RECORD, status: 'planned', unit_ids: ['u1', 'u2', 'u3'],
    } as MaintenanceRecord
    STORED_UNITS = Object.fromEntries(three().map((one) => [
      one.unit_id,
      { ...one, planned_maintenance_record_id: 'rec-1' } as InventoryUnit,
    ]))
    STORED_UNITS.u4 = unit({ unit_id: 'u4', asset_code: 'CLAMP-004' })
  })

  it('swaps equipment while it is still a plan', async () => {
    await updateMaintenancePlan({
      record: STORED_RECORD,
      units: [STORED_UNITS.u1 as InventoryUnit, STORED_UNITS.u3 as InventoryUnit,
        STORED_UNITS.u4 as InventoryUnit],
      input: PLAN_INPUT,
    })

    const record = writesTo(attempts[0], 'maintenance_records/')[0]?.data
    expect(record?.unit_ids).toEqual(['u1', 'u3', 'u4'])

    // The dropped one loses its pointer, the added one gains it, and neither
    // moves an inch.
    const dropped = writesTo(attempts[0], 'inventory_units/').find((w) => w.path.endsWith('/u2'))
    const added = writesTo(attempts[0], 'inventory_units/').find((w) => w.path.endsWith('/u4'))
    expect(dropped?.data.planned_maintenance_record_id).toBeUndefined()
    expect(added?.data.planned_maintenance_record_id).toBe('rec-1')
    expect(writesTo(attempts[0], 'inventory_items/')).toHaveLength(0)
  })

  it('refuses to change equipment once the repair has started', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'sent' } as MaintenanceRecord

    await expect(updateMaintenancePlan({
      record: STORED_RECORD, units: three(), input: PLAN_INPUT,
    })).rejects.toThrow(/settled once it has started/i)
  })

  it('calls off a plan by releasing the pointers', async () => {
    await cancelMaintenancePlan({ record: STORED_RECORD, input: PLAN_INPUT })

    expect(writesTo(attempts[0], 'maintenance_records/')[0]?.data.status).toBe('cancelled')
    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.planned_maintenance_record_id).toBeUndefined()
      expect(write.data.status).toBe('available')
    }
    // Nothing came back, because nothing had gone.
    expect(writesTo(attempts[0], 'inventory_items/')).toHaveLength(0)
    expect(writesTo(attempts[0], 'asset_events/')).toHaveLength(0)
  })

  it('refuses to call off a repair that has started', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'in_service' } as MaintenanceRecord

    await expect(cancelMaintenancePlan({ record: STORED_RECORD, input: PLAN_INPUT }))
      .rejects.toThrow(/returns the equipment/i)
  })
})

describe('starting a planned repair', () => {
  const PLAN_INPUT = { issueDescription: 'Crackling on channel 2' }

  beforeEach(() => {
    STORED_RECORD = {
      ...STORED_RECORD, status: 'planned', unit_ids: ['u1', 'u2', 'u3'],
    } as MaintenanceRecord
    STORED_UNITS = Object.fromEntries(three().map((one) => [
      one.unit_id,
      { ...one, planned_maintenance_record_id: 'rec-1' } as InventoryUnit,
    ]))
  })

  it.each(['sent', 'in_service', 'ready'] as const)('starts at %s', async (status) => {
    await startPlannedMaintenance({ record: STORED_RECORD, status, input: PLAN_INPUT })

    expect(writesTo(attempts[0], 'maintenance_records/')[0]?.data.status).toBe(status)
    expect(writesTo(attempts[0], 'inventory_units/')).toHaveLength(3)
    expect(writesTo(attempts[0], 'inventory_items/')).toHaveLength(1)
    // One lifecycle transition, whatever stage the paperwork says.
    expect(writesTo(attempts[0], 'asset_events/')).toHaveLength(1)
  })

  it('moves the equipment and clears the plan in the same write', async () => {
    await startPlannedMaintenance({ record: STORED_RECORD, status: 'sent', input: PLAN_INPUT })

    for (const write of writesTo(attempts[0], 'inventory_units/')) {
      expect(write.data.status).toBe('in_maintenance')
      expect(write.data.current_maintenance_record_id).toBe('rec-1')
      expect(write.data.maintenance_record_ids).toEqual(['rec-1'])
      // The plan is over the moment it becomes a repair.
      expect(write.data.planned_maintenance_record_id).toBeUndefined()
    }

    expect(writesTo(attempts[0], 'inventory_items/')[0]?.data.unit_counts)
      .toMatchObject({ available: 0, in_maintenance: 3 })
  })

  it('refuses to start when a unit has been borrowed in the meantime', async () => {
    // A plan reserves nothing, so this is a real obstacle rather than an
    // impossibility — and the message says which microphone.
    STORED_UNITS.u2 = {
      ...STORED_UNITS.u2, status: 'in_use', asset_code: 'MIC-002',
    } as InventoryUnit

    await expect(startPlannedMaintenance({
      record: STORED_RECORD, status: 'sent', input: PLAN_INPUT,
    })).rejects.toThrow(/MIC-002/)
  })

  it('names every unit in the way, not just the first', async () => {
    STORED_UNITS.u2 = {
      ...STORED_UNITS.u2, status: 'in_use', asset_code: 'MIC-002',
    } as InventoryUnit
    STORED_UNITS.u3 = {
      ...STORED_UNITS.u3, status: 'lost', asset_code: 'MIC-007',
    } as InventoryUnit

    await expect(startPlannedMaintenance({
      record: STORED_RECORD, status: 'sent', input: PLAN_INPUT,
    })).rejects.toThrow(/MIC-002.*MIC-007|MIC-007.*MIC-002/)
  })

  it('writes nothing when it cannot start', async () => {
    STORED_UNITS.u2 = { ...STORED_UNITS.u2, status: 'in_use' } as InventoryUnit

    await expect(startPlannedMaintenance({
      record: STORED_RECORD, status: 'sent', input: PLAN_INPUT,
    })).rejects.toThrow()

    expect(attempts[0]?.writes).toEqual([])
  })

  it('refuses to start a repair that has already started', async () => {
    STORED_RECORD = { ...STORED_RECORD, status: 'sent' } as MaintenanceRecord

    await expect(startPlannedMaintenance({
      record: STORED_RECORD, status: 'in_service', input: PLAN_INPUT,
    })).rejects.toThrow(/already started/i)
  })

  it('refuses to start a plan into planned', async () => {
    await expect(startPlannedMaintenance({
      record: STORED_RECORD, status: 'planned', input: PLAN_INPUT,
    })).rejects.toThrow(/sent, in service, or ready/i)
  })

  it('reuses one event id across a retried start', async () => {
    attemptsToRun = 2

    await startPlannedMaintenance({ record: STORED_RECORD, status: 'sent', input: PLAN_INPUT })

    expect(allocatedIds).toHaveLength(1)
  })
})
