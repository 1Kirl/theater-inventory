import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import { EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS } from '@/domain/inventory'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'

/**
 * The transaction contract of a lifecycle action.
 *
 * Three documents in one transaction, a stable event id across retries, and
 * nothing written at all when the action is refused. The Rules tests prove what
 * Firestore will accept; these prove what the service actually sends.
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

/** What each read returns inside the transaction. Set per test. */
let STORED_UNIT: InventoryUnit
let STORED_ITEM: InventoryItem

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
            const data = ref.path.startsWith('inventory_units/') ? STORED_UNIT : STORED_ITEM
            return Promise.resolve({ exists: () => true, data: () => data })
          },
          set: (ref: { path: string }, data: Record<string, unknown>) => {
            attempt.writes.push({ path: ref.path, data })
          },
        })
      }
    },
  }
})

const { lifecycleRefusal, performLifecycleAction } = await import(
  '@/services/unit-lifecycle-service'
)

const ITEM: InventoryItem = {
  item_id: 'item-1',
  organization_id: 'org-1',
  team_id: 'team-lighting',
  name: 'C-Clamp',
  category: 'Hardware',
  tracking_mode: 'serialized',
  unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 1, available: 1 },
  quantity_total: 1,
  quantity_available: 1,
  condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 1 },
  location: 'Lighting Storage A',
  created_by_uid: 'uid-admin',
  created_at: Timestamp.fromMillis(1_000),
  updated_at: Timestamp.fromMillis(1_000),
} as InventoryItem

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'unit-1',
    organization_id: 'org-1',
    inventory_item_id: 'item-1',
    team_id: 'team-lighting',
    asset_code: 'CLAMP-001',
    condition: 'good',
    status: 'available',
    storage_location: 'Lighting Storage A',
    created_by_uid: 'uid-admin',
    created_at: Timestamp.fromMillis(1_000),
    updated_at: Timestamp.fromMillis(1_000),
    ...overrides,
  } as InventoryUnit
}

function unitWrite(attempt: Attempt | undefined) {
  return attempt?.writes.find((write) => write.path.startsWith('inventory_units/'))?.data
}
function itemWrite(attempt: Attempt | undefined) {
  return attempt?.writes.find((write) => write.path.startsWith('inventory_items/'))?.data
}
function eventWrite(attempt: Attempt | undefined) {
  return attempt?.writes.find((write) => write.path.startsWith('asset_events/'))?.data
}

beforeEach(() => {
  allocatedIds = []
  idCounter = 0
  attempts = []
  attemptsToRun = 1
  looseWrites = []
  auth.currentUser = { uid: 'uid-actor' }
  STORED_UNIT = unit()
  STORED_ITEM = ITEM
})

describe('a lifecycle action is one transaction over three documents', () => {
  it('writes the unit, the parent, and exactly one event', async () => {
    await performLifecycleAction({
      unit: unit(), to: 'in_use', usingTeamId: 'team-costume',
    })

    expect(attempts).toHaveLength(1)
    const written = attempts[0]?.writes ?? []
    expect(written.filter((w) => w.path.startsWith('inventory_units/'))).toHaveLength(1)
    expect(written.filter((w) => w.path.startsWith('inventory_items/'))).toHaveLength(1)
    expect(written.filter((w) => w.path.startsWith('asset_events/'))).toHaveLength(1)
  })

  it('reads both documents before writing anything', async () => {
    await performLifecycleAction({ unit: unit(), to: 'lost' })

    expect(attempts[0]?.reads).toEqual(['inventory_units/unit-1', 'inventory_items/item-1'])
  })

  it('makes no write outside the transaction', async () => {
    await performLifecycleAction({ unit: unit(), to: 'lost' })

    expect(looseWrites).toEqual([])
  })
})

describe('marking a unit as in use', () => {
  it('records the borrowing team on the unit', async () => {
    await performLifecycleAction({
      unit: unit(), to: 'in_use', usingTeamId: 'team-costume', usingMemberUid: 'uid-alex',
    })

    const written = unitWrite(attempts[0])
    expect(written?.status).toBe('in_use')
    expect(written?.using_team_id).toBe('team-costume')
    expect(written?.using_member_uid).toBe('uid-alex')
    expect(written?.checked_out_at).toBeDefined()
  })

  it('does not touch the owning team', async () => {
    // Borrowed by Costume, still Lighting's property.
    await performLifecycleAction({
      unit: unit(), to: 'in_use', usingTeamId: 'team-costume',
    })

    expect(unitWrite(attempts[0])?.team_id).toBe('team-lighting')
  })

  it('takes the unit out of the parent availability', async () => {
    await performLifecycleAction({
      unit: unit(), to: 'in_use', usingTeamId: 'team-costume',
    })

    expect(itemWrite(attempts[0])?.unit_counts).toMatchObject({
      available: 0, in_use: 1, active_total: 1,
    })
    expect(itemWrite(attempts[0])?.quantity_available).toBe(0)
  })

  it('refuses without a borrowing team, before any write', async () => {
    await expect(performLifecycleAction({ unit: unit(), to: 'in_use' }))
      .rejects.toThrow(/which team/i)

    expect(attempts).toEqual([])
  })

  it('leaves the member optional', async () => {
    await performLifecycleAction({
      unit: unit(), to: 'in_use', usingTeamId: 'team-costume',
    })

    expect(unitWrite(attempts[0])?.using_member_uid).toBeUndefined()
    expect(eventWrite(attempts[0])?.using_member_uid).toBeUndefined()
  })

  it('refuses to take out an unusable unit', async () => {
    const broken = unit({ condition: 'unusable' })
    STORED_UNIT = broken

    await expect(performLifecycleAction({
      unit: broken, to: 'in_use', usingTeamId: 'team-costume',
    })).rejects.toThrow(/unusable/i)

    expect(attempts).toEqual([])
  })
})

describe('checking a unit back in', () => {
  beforeEach(() => {
    STORED_UNIT = unit({
      status: 'in_use',
      using_team_id: 'team-costume',
      using_member_uid: 'uid-alex',
      checked_out_at: Timestamp.fromMillis(2_000),
    })
  })

  it('clears the loan from the unit', async () => {
    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    const written = unitWrite(attempts[0])
    expect(written?.status).toBe('available')
    expect(written?.using_team_id).toBeUndefined()
    expect(written?.using_member_uid).toBeUndefined()
    expect(written?.checked_out_at).toBeUndefined()
  })

  it('keeps who had it in the history, which is now the only record of it', async () => {
    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    const event = eventWrite(attempts[0])
    expect(event?.event_type).toBe('checked_in')
    expect(event?.using_team_id).toBe('team-costume')
    expect(event?.using_member_uid).toBe('uid-alex')
  })

  it('does not change the condition', async () => {
    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    expect(unitWrite(attempts[0])?.condition).toBe('good')
  })

  it('returns an unusable unit to stock but not to availability', async () => {
    STORED_UNIT = unit({ status: 'in_use', condition: 'unusable', using_team_id: 'team-costume' })
    STORED_ITEM = {
      ...ITEM,
      unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 1, in_use: 1 },
      quantity_total: 1,
      quantity_available: 0,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, unusable: 1 },
    } as InventoryItem

    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    expect(itemWrite(attempts[0])?.unit_counts).toMatchObject({
      available: 0, unusable_on_hand: 1, in_use: 0,
    })
    expect(itemWrite(attempts[0])?.quantity_available).toBe(0)
  })
})

describe('marking a unit lost', () => {
  it('from in use, the loan is cleared but the history keeps it', async () => {
    STORED_UNIT = unit({
      status: 'in_use', using_team_id: 'team-costume', using_member_uid: 'uid-alex',
    })

    await performLifecycleAction({ unit: STORED_UNIT, to: 'lost', note: 'not back from the gig' })

    const written = unitWrite(attempts[0])
    expect(written?.status).toBe('lost')
    expect(written?.using_team_id).toBeUndefined()
    expect(written?.using_member_uid).toBeUndefined()

    // "Who had this when it went missing" has to stay answerable.
    const event = eventWrite(attempts[0])
    expect(event?.event_type).toBe('marked_lost')
    expect(event?.using_team_id).toBe('team-costume')
    expect(event?.using_member_uid).toBe('uid-alex')
    expect(event?.note).toBe('not back from the gig')
  })

  it('from available, the parent availability drops', async () => {
    await performLifecycleAction({ unit: unit(), to: 'lost' })

    expect(itemWrite(attempts[0])?.unit_counts).toMatchObject({ available: 0, lost: 1 })
    // Missing, not written off.
    expect(itemWrite(attempts[0])?.quantity_total).toBe(1)
  })
})

describe('finding and retiring', () => {
  it('a found unit returns to the shelf', async () => {
    STORED_UNIT = unit({ status: 'lost' })
    STORED_ITEM = {
      ...ITEM,
      unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 1, lost: 1 },
      quantity_available: 0,
    } as InventoryItem

    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    expect(eventWrite(attempts[0])?.event_type).toBe('marked_found')
    expect(itemWrite(attempts[0])?.unit_counts).toMatchObject({ lost: 0, available: 1 })
  })

  it('a retirement needs a reason and records it', async () => {
    await performLifecycleAction({ unit: unit(), to: 'retired', retirementReason: 'disposed' })

    expect(unitWrite(attempts[0])?.retirement_reason).toBe('disposed')
    expect(eventWrite(attempts[0])?.retirement_reason).toBe('disposed')
    expect(itemWrite(attempts[0])?.unit_counts).toMatchObject({ retired: 1, active_total: 0 })
  })

  it('refuses a retirement with no reason, before any write', async () => {
    await expect(performLifecycleAction({ unit: unit(), to: 'retired' }))
      .rejects.toThrow(/why/i)

    expect(attempts).toEqual([])
  })

  it('refuses to retire a unit that is out', async () => {
    // Get it back or report it lost first; retiring something you do not have
    // is not a decision anyone can make honestly.
    STORED_UNIT = unit({ status: 'in_use', using_team_id: 'team-costume' })

    await expect(performLifecycleAction({
      unit: STORED_UNIT, to: 'retired', retirementReason: 'disposed',
    })).rejects.toThrow()

    expect(attempts).toEqual([])
  })

  it('refuses to do anything with a retired unit', async () => {
    STORED_UNIT = unit({ status: 'retired', retirement_reason: 'disposed' })

    await expect(performLifecycleAction({ unit: STORED_UNIT, to: 'available' })).rejects.toThrow()
    expect(attempts).toEqual([])
  })

  it('refuses a move into maintenance, which needs a repair record', async () => {
    await expect(performLifecycleAction({ unit: unit(), to: 'in_maintenance' })).rejects.toThrow()
    expect(attempts).toEqual([])
  })
})

describe('the unit names the event that moved it', () => {
  it('points the unit at the event written in the same transaction', async () => {
    // What makes a status change without history impossible: Rules require
    // this to name a real event describing exactly this move.
    await performLifecycleAction({ unit: unit(), to: 'lost' })

    const eventPath = attempts[0]?.writes
      .find((write) => write.path.startsWith('asset_events/'))?.path
    const eventId = eventPath?.split('/')[1]

    expect(unitWrite(attempts[0])?.last_lifecycle_event_id).toBe(eventId)
  })

  it('uses the same id on both documents after a retry', async () => {
    attemptsToRun = 2

    await performLifecycleAction({ unit: unit(), to: 'lost' })

    expect(unitWrite(attempts[1])?.last_lifecycle_event_id)
      .toBe(unitWrite(attempts[0])?.last_lifecycle_event_id)
    expect(allocatedIds).toHaveLength(1)
  })

  it('advances the pointer rather than keeping the previous event', async () => {
    STORED_UNIT = unit({ last_lifecycle_event_id: 'event-earlier' })

    await performLifecycleAction({ unit: STORED_UNIT, to: 'lost' })

    expect(unitWrite(attempts[0])?.last_lifecycle_event_id).not.toBe('event-earlier')
  })
})

describe('retry behaviour', () => {
  it('reuses one event id when the transaction runs again', async () => {
    attemptsToRun = 2

    await performLifecycleAction({ unit: unit(), to: 'lost' })

    // One id allocated in total, not one per attempt: a retry that generated a
    // fresh id would append a second event for a single action.
    expect(allocatedIds).toHaveLength(1)

    const first = attempts[0]?.writes.map((w) => w.path)
    const second = attempts[1]?.writes.map((w) => w.path)
    expect(second).toEqual(first)
  })

  it('does not double-count the parent when the transaction runs again', async () => {
    attemptsToRun = 2

    await performLifecycleAction({ unit: unit(), to: 'lost' })

    expect(itemWrite(attempts[1])).toEqual(itemWrite(attempts[0]))
    expect(itemWrite(attempts[1])?.unit_counts).toMatchObject({ lost: 1, available: 0 })
  })
})

describe('acting on state that moved underneath', () => {
  it('refuses when the unit is no longer what the page showed', async () => {
    // The page offered Check In; by the time it ran, somebody had marked it
    // lost. The re-read inside the transaction is what catches it.
    const stale = unit({ status: 'in_use', using_team_id: 'team-costume' })
    STORED_UNIT = unit({ status: 'lost' })

    await expect(performLifecycleAction({ unit: stale, to: 'available' }))
      .rejects.toThrow(/moved this unit while this page was open/i)
  })

  it('writes nothing when the unit moved underneath', async () => {
    const stale = unit({ status: 'in_use', using_team_id: 'team-costume' })
    STORED_UNIT = unit({ status: 'lost' })

    await expect(performLifecycleAction({ unit: stale, to: 'available' })).rejects.toThrow()

    expect(attempts[0]?.writes).toEqual([])
    expect(looseWrites).toEqual([])
  })

  it('refuses when the parent is not a serialized item', async () => {
    STORED_ITEM = { ...ITEM, tracking_mode: 'bulk' } as InventoryItem

    await expect(performLifecycleAction({ unit: unit(), to: 'lost' })).rejects.toThrow(/quantity/i)
  })

  it('refuses when nobody is signed in', async () => {
    auth.currentUser = null

    await expect(performLifecycleAction({ unit: unit(), to: 'lost' })).rejects.toThrow()
    expect(attempts).toEqual([])
  })
})

describe('lifecycleRefusal is what the buttons ask', () => {
  it('allows the moves the unit page offers', () => {
    expect(lifecycleRefusal({ unit: unit(), to: 'lost' })).toBeNull()
    expect(lifecycleRefusal({
      unit: unit(), to: 'in_use', usingTeamId: 'team-costume',
    })).toBeNull()
  })

  it('refuses a move to the status it already has', () => {
    expect(lifecycleRefusal({ unit: unit(), to: 'available' })).not.toBeNull()
  })

  it('refuses a move the model forbids outright', () => {
    expect(lifecycleRefusal({ unit: unit({ status: 'retired' }), to: 'available' })).not.toBeNull()
  })

  it('refuses an over-long note', () => {
    expect(lifecycleRefusal({ unit: unit(), to: 'lost', note: 'x'.repeat(2001) })).not.toBeNull()
  })
})

/**
 * Fields a lifecycle move must leave alone.
 *
 * A unit write replaces the whole document, so anything this service forgets to
 * carry is deleted. That is not hypothetical: an earlier version built the
 * document by hand and dropped every maintenance link, so marking a planned
 * unit as in use silently unlinked it from its plan — Security Rules refused
 * the write and the browser showed a permission error — and marking any unit
 * lost would have erased its entire repair history with nothing to catch it.
 */
describe('a lifecycle move preserves what it does not own', () => {
  const LINKED = unit({
    planned_maintenance_record_id: 'plan-a',
    maintenance_record_ids: ['rec-old-1', 'rec-old-2'],
  })

  beforeEach(() => {
    STORED_UNIT = LINKED
  })

  it('keeps the maintenance plan when a unit is taken out', () => {
    // The exact browser regression: Available + Planned → In Use + Planned.
    return performLifecycleAction({
      unit: LINKED, to: 'in_use', usingTeamId: 'team-costume',
    }).then(() => {
      const written = unitWrite(attempts[0])

      expect(written?.status).toBe('in_use')
      expect(written?.planned_maintenance_record_id).toBe('plan-a')
      expect(written?.using_team_id).toBe('team-costume')
      expect(written?.checked_out_at).toBeDefined()
    })
  })

  it('keeps the repair history when a unit is taken out', () => {
    return performLifecycleAction({
      unit: LINKED, to: 'in_use', usingTeamId: 'team-costume',
    }).then(() => {
      expect(unitWrite(attempts[0])?.maintenance_record_ids)
        .toEqual(['rec-old-1', 'rec-old-2'])
    })
  })

  it('keeps both when a unit is checked back in', async () => {
    STORED_UNIT = unit({
      status: 'in_use',
      using_team_id: 'team-costume',
      using_member_uid: 'uid-alex',
      checked_out_at: Timestamp.fromMillis(2_000),
      planned_maintenance_record_id: 'plan-a',
      maintenance_record_ids: ['rec-old-1'],
    })

    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    const written = unitWrite(attempts[0])
    expect(written?.status).toBe('available')
    expect(written?.planned_maintenance_record_id).toBe('plan-a')
    expect(written?.maintenance_record_ids).toEqual(['rec-old-1'])
    // The loan itself is over, and those fields do go.
    expect(written?.using_team_id).toBeUndefined()
    expect(written?.using_member_uid).toBeUndefined()
    expect(written?.checked_out_at).toBeUndefined()
  })

  it.each(['lost', 'retired'] as const)('keeps both when a unit is %s', async (to) => {
    await performLifecycleAction({
      unit: LINKED,
      to,
      ...(to === 'retired' ? { retirementReason: 'disposed' as const } : {}),
    })

    const written = unitWrite(attempts[0])
    expect(written?.status).toBe(to)
    // A plan is not deleted on the unit's behalf; it becomes something the user
    // has to resolve, which is what they should see.
    expect(written?.planned_maintenance_record_id).toBe('plan-a')
    expect(written?.maintenance_record_ids).toEqual(['rec-old-1', 'rec-old-2'])
  })

  it('keeps both when a lost unit is found again', async () => {
    STORED_UNIT = unit({
      status: 'lost',
      planned_maintenance_record_id: 'plan-a',
      maintenance_record_ids: ['rec-old-1'],
    })

    await performLifecycleAction({ unit: STORED_UNIT, to: 'available' })

    const written = unitWrite(attempts[0])
    expect(written?.planned_maintenance_record_id).toBe('plan-a')
    expect(written?.maintenance_record_ids).toEqual(['rec-old-1'])
  })

  it('does not invent a maintenance link on a unit that has none', async () => {
    STORED_UNIT = unit()

    await performLifecycleAction({ unit: STORED_UNIT, to: 'lost' })

    const written = unitWrite(attempts[0])
    expect(written?.planned_maintenance_record_id).toBeUndefined()
    expect(written?.maintenance_record_ids).toBeUndefined()
    expect(written?.current_maintenance_record_id).toBeUndefined()
  })

  it('writes no maintenance record and no maintenance event', async () => {
    await performLifecycleAction({
      unit: LINKED, to: 'in_use', usingTeamId: 'team-costume',
    })

    const written = attempts[0]?.writes ?? []
    expect(written.filter((w) => w.path.startsWith('maintenance_records/'))).toHaveLength(0)
    // One ordinary lifecycle event, not a maintenance batch event.
    const events = written.filter((w) => w.path.startsWith('asset_events/'))
    expect(events).toHaveLength(1)
    expect(events[0]?.data.event_type).toBe('marked_in_use')
  })
})
