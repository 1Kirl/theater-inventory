import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { PromotionDraft } from '@/domain/inventory-unit'
import { EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS } from '@/domain/inventory'

/**
 * The transaction contract of the real service, not a synthetic write.
 *
 * The Rules tests prove what Security Rules will accept. These prove what the
 * service actually sends: that a promotion is one atomic unit, that a contended
 * retry cannot commit a second set of units or double-count the parent, and
 * that nothing is written at all when the drafts still carry a decision the
 * user has not made.
 */

const auth = { currentUser: { uid: 'uid-editor' } as { uid: string } | null }

let allocatedIds: string[] = []
let idCounter = 0

/** One recorded attempt at the transaction body. */
interface Attempt {
  reads: string[]
  writes: { path: string; data: Record<string, unknown> }[]
}

let attempts: Attempt[] = []
let attemptsToRun = 1
/** Writes made outside any transaction, which for these operations must be none. */
let looseWrites: string[] = []

/** What the maintenance query returns. Set per test. */
let maintenanceRecords: { status: string; quantity_sent: number }[] = []
/** When true, the maintenance read fails the way a permission denial would. */
let maintenanceReadFails = false

vi.mock('@/services/maintenance-service', () => ({
  listMaintenanceRecordsForItem: () => {
    if (maintenanceReadFails) return Promise.reject(new Error('permission-denied'))
    return Promise.resolve(maintenanceRecords)
  },
}))

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
        // A generated ref. Every call hands back a fresh id, which is exactly
        // what makes allocating them inside a retried transaction a bug.
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
    runTransaction: async (
      _db: unknown,
      body: (transaction: unknown) => Promise<void>,
    ) => {
      // Firestore re-runs the body when the read set changed underneath it.
      // Running it more than once here is how a retry is reproduced.
      for (let run = 0; run < attemptsToRun; run += 1) {
        const attempt: Attempt = { reads: [], writes: [] }
        attempts.push(attempt)

        await body({
          get: (ref: { path: string }) => {
            if (attempt.writes.length > 0) {
              throw new Error(`read after write in a transaction: ${ref.path}`)
            }
            attempt.reads.push(ref.path)
            return Promise.resolve({
              exists: () => true,
              data: () => STORED_ITEM,
            })
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
  createInventoryUnits, promoteToSerialized, updateInventoryUnit,
} = await import('@/services/inventory-unit-service')

const BULK_ITEM: InventoryItem = {
  item_id: 'item-1',
  organization_id: 'org-1',
  team_id: 'team-lighting',
  name: 'C-Clamp',
  category: 'Hardware',
  tracking_mode: 'bulk',
  quantity_total: 4,
  quantity_available: 3,
  condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 3 },
  location: 'Lighting Storage A',
  created_by_uid: 'uid-admin',
  created_at: Timestamp.fromMillis(1_000),
  updated_at: Timestamp.fromMillis(1_000),
} as InventoryItem

const SERIALIZED_ITEM: InventoryItem = {
  ...BULK_ITEM,
  tracking_mode: 'serialized',
  unit_counts: EMPTY_UNIT_COUNTS,
  quantity_total: 0,
  quantity_available: 0,
  condition_counts: EMPTY_CONDITION_COUNTS,
} as InventoryItem

/** What the transaction reads back for the parent. Set per test. */
let STORED_ITEM: InventoryItem = BULK_ITEM

const TEAMS = ['team-lighting', 'team-costume']

/** A stored unit, for the tests that edit one. */
function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'u1',
    organization_id: 'org-1',
    inventory_item_id: 'item-1',
    team_id: 'team-lighting',
    asset_code: 'CLAMP-001',
    condition: 'good',
    status: 'available',
    storage_location: 'Shelf',
    created_by_uid: 'uid-admin',
    created_at: Timestamp.fromMillis(1_000),
    updated_at: Timestamp.fromMillis(1_000),
    ...overrides,
  } as InventoryUnit
}

function itemWriteOf(attempt: Attempt | undefined) {
  return attempt?.writes.find((write) => write.path === 'inventory_items/item-1')?.data as
    Record<string, unknown> | undefined
}

function draft(overrides: Partial<PromotionDraft> = {}): PromotionDraft {
  return {
    assetCode: 'CLAMP-001',
    condition: 'good',
    status: 'available',
    storageLocation: 'Lighting Storage A',
    owningTeamId: 'team-lighting',
    ...overrides,
  }
}

function fourDrafts(): PromotionDraft[] {
  return ['001', '002', '003', '004'].map((suffix) => draft({ assetCode: `CLAMP-${suffix}` }))
}

beforeEach(() => {
  allocatedIds = []
  idCounter = 0
  attempts = []
  attemptsToRun = 1
  looseWrites = []
  auth.currentUser = { uid: 'uid-editor' }
  STORED_ITEM = BULK_ITEM
  maintenanceRecords = []
  maintenanceReadFails = false
})

describe('promoteToSerialized — atomicity', () => {
  it('writes every unit and the parent flip in one transaction', async () => {
    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    expect(attempts).toHaveLength(1)
    const written = attempts[0]?.writes ?? []

    expect(written.filter((write) => write.path.startsWith('inventory_units/'))).toHaveLength(4)
    expect(written.filter((write) => write.path === 'inventory_items/item-1')).toHaveLength(1)
  })

  it('makes no write outside the transaction', async () => {
    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    expect(looseWrites).toEqual([])
  })

  it('reads the parent before writing anything', async () => {
    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    expect(attempts[0]?.reads).toEqual(['inventory_items/item-1'])
  })

  it('turns the parent serialized with mirrors matching the units written', async () => {
    await promoteToSerialized({
      item: BULK_ITEM,
      drafts: [
        draft({ assetCode: 'CLAMP-001' }),
        draft({ assetCode: 'CLAMP-002' }),
        draft({ assetCode: 'CLAMP-003', status: 'in_use', usingTeamId: 'team-costume' }),
        draft({ assetCode: 'CLAMP-004', condition: 'unusable' }),
      ],
      teamIds: TEAMS,
    })

    const parent = attempts[0]?.writes.find((write) => write.path === 'inventory_items/item-1')
    const units = attempts[0]?.writes.filter((write) => write.path.startsWith('inventory_units/'))

    expect(parent?.data.tracking_mode).toBe('serialized')
    expect(parent?.data.unit_counts).toEqual({
      active_total: 4, available: 2, unusable_on_hand: 1,
      in_use: 1, in_maintenance: 0, lost: 0, retired: 0,
    })
    expect(parent?.data.quantity_total).toBe(4)
    expect(parent?.data.quantity_available).toBe(2)
    expect(units).toHaveLength(4)
  })

  it('writes nothing when a draft is still unclassified', async () => {
    const drafts = fourDrafts()
    drafts[3] = draft({ assetCode: 'CLAMP-004', condition: null })

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS }))
      .rejects.toThrow(/condition/i)

    expect(attempts).toEqual([])
    expect(looseWrites).toEqual([])
  })

  it('writes nothing when an in-use draft names no team', async () => {
    const drafts = fourDrafts()
    drafts[2] = draft({ assetCode: 'CLAMP-003', status: 'in_use' })

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS }))
      .rejects.toThrow(/which team has it/i)

    expect(attempts).toEqual([])
  })

  it('writes nothing when an in-use draft names a team from elsewhere', async () => {
    const drafts = fourDrafts()
    drafts[2] = draft({ assetCode: 'CLAMP-003', status: 'in_use', usingTeamId: 'team-elsewhere' })

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS }))
      .rejects.toThrow(/does not belong to this organization/i)

    expect(attempts).toEqual([])
  })

  it('refuses a draft initialized into maintenance, before any write', async () => {
    const drafts = fourDrafts()
    drafts[1] = draft({ assetCode: 'CLAMP-002', status: 'in_maintenance' })

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS }))
      .rejects.toThrow(/available, in use, or lost/i)

    expect(attempts).toEqual([])
    expect(looseWrites).toEqual([])
  })

  it('accepts a draft initialized as lost', async () => {
    const drafts = fourDrafts()
    drafts[1] = draft({ assetCode: 'CLAMP-002', status: 'lost' })

    await promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS })

    const parent = attempts[0]?.writes.find((write) => write.path === 'inventory_items/item-1')
    expect(parent?.data.unit_counts).toMatchObject({ lost: 1, available: 3, active_total: 4 })
  })

  it('records the reviewer\'s team on an in-use unit, not the item\'s owning team', async () => {
    await promoteToSerialized({
      item: BULK_ITEM,
      drafts: [
        draft({ assetCode: 'CLAMP-001' }),
        draft({ assetCode: 'CLAMP-002' }),
        draft({ assetCode: 'CLAMP-003' }),
        draft({ assetCode: 'CLAMP-004', status: 'in_use', usingTeamId: 'team-costume' }),
      ],
      teamIds: TEAMS,
    })

    const inUse = attempts[0]?.writes.find((write) => write.data.status === 'in_use')

    expect(inUse?.data.using_team_id).toBe('team-costume')
    // The unit still belongs to Lighting; Costume merely has it.
    expect(inUse?.data.team_id).toBe('team-lighting')
  })

  it('refuses an item that is already serialized, before any write', async () => {
    await expect(promoteToSerialized({
      item: SERIALIZED_ITEM, drafts: fourDrafts(), teamIds: TEAMS,
    })).rejects.toThrow(/already tracks individual equipment/i)

    expect(attempts).toEqual([])
  })

  it('aborts when the item was converted by someone else while the wizard was open', async () => {
    // The read inside the transaction is what catches it: the page's copy said
    // bulk, and by the time the transaction ran it was not.
    STORED_ITEM = SERIALIZED_ITEM

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS }))
      .rejects.toThrow(/already tracks individual equipment/i)
  })
})

describe('promoteToSerialized — retry behaviour', () => {
  it('reuses the same unit ids when the transaction runs again', async () => {
    attemptsToRun = 2

    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    // Four refs allocated in total, not four per attempt: a retry that
    // generated fresh ids would commit a second set of units.
    expect(allocatedIds).toHaveLength(4)

    const first = attempts[0]?.writes.map((write) => write.path)
    const second = attempts[1]?.writes.map((write) => write.path)
    expect(second).toEqual(first)
  })

  it('does not double-count the parent when the transaction runs again', async () => {
    attemptsToRun = 2

    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    const parentOf = (attempt: Attempt | undefined) =>
      attempt?.writes.find((write) => write.path === 'inventory_items/item-1')?.data

    expect(parentOf(attempts[1])).toEqual(parentOf(attempts[0]))
    expect((parentOf(attempts[1]) as { quantity_total: number }).quantity_total).toBe(4)
  })
})

describe('createInventoryUnits — atomicity and retry behaviour', () => {
  beforeEach(() => {
    STORED_ITEM = SERIALIZED_ITEM
  })

  it('writes every unit and the parent in one transaction', async () => {
    await createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [
        { assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' },
        { assetCode: 'A-2', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' },
      ],
    })

    const written = attempts[0]?.writes ?? []
    expect(written.filter((write) => write.path.startsWith('inventory_units/'))).toHaveLength(2)
    expect(written.filter((write) => write.path === 'inventory_items/item-1')).toHaveLength(1)
    expect(looseWrites).toEqual([])
  })

  it('adds to whatever the parent says now, rather than to a stale page copy', async () => {
    // The caller passes an item claiming no units; the stored one already has
    // three. The counts must follow the stored one.
    STORED_ITEM = {
      ...SERIALIZED_ITEM,
      unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 3, available: 3 },
      quantity_total: 3,
      quantity_available: 3,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 3 },
    } as InventoryItem

    await createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{ assetCode: 'A-4', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' }],
    })

    const parent = attempts[0]?.writes.find((write) => write.path === 'inventory_items/item-1')
    expect(parent?.data.quantity_total).toBe(4)
  })

  it('reuses unit ids and recomputes the same counts on a retry', async () => {
    attemptsToRun = 2

    await createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [
        { assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' },
        { assetCode: 'A-2', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' },
      ],
    })

    expect(allocatedIds).toHaveLength(2)

    const parentOf = (attempt: Attempt | undefined) =>
      attempt?.writes.find((write) => write.path === 'inventory_items/item-1')?.data
    expect(parentOf(attempts[1])).toEqual(parentOf(attempts[0]))
  })

  it.each(['in_maintenance', 'retired'] as const)(
    'refuses to create a unit directly as %s',
    async (status) => {
      // Maintenance needs the repair record that explains it; retirement needs
      // a history to retire from. Neither can be conjured at creation.
      await expect(createInventoryUnits({
        teamIds: TEAMS,
        item: SERIALIZED_ITEM,
        units: [{
          assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status,
          storageLocation: 'Shelf',
          ...(status === 'retired' ? { retirementReason: 'disposed' as const } : {}),
        }],
      })).rejects.toThrow(/available, in use, or lost/i)

      expect(attempts).toEqual([])
      expect(looseWrites).toEqual([])
    },
  )

  it('registers a unit that is already out with a crew', async () => {
    // Adding an asset is not the same as acquiring one. This clamp is already
    // in somebody's hands, and saying so is more honest than filing it as
    // available and immediately checking it out.
    await createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'in_use',
        storageLocation: 'Shelf', usingTeamId: 'team-costume',
      }],
    })

    const unit = attempts[0]?.writes.find((write) => write.path.startsWith('inventory_units/'))
    expect(unit?.data.status).toBe('in_use')
    expect(unit?.data.using_team_id).toBe('team-costume')
    expect(itemWriteOf(attempts[0])?.unit_counts).toMatchObject({ in_use: 1, available: 0 })
  })

  it('registers a unit that is already missing', async () => {
    await createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'lost',
        storageLocation: 'Shelf',
      }],
    })

    expect(itemWriteOf(attempts[0])?.unit_counts).toMatchObject({ lost: 1, available: 0 })
  })

  it('still refuses an in-use registration with no borrowing team', async () => {
    await expect(createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'in_use',
        storageLocation: 'Shelf',
      }],
    })).rejects.toThrow(/which team has it/i)

    expect(attempts).toEqual([])
  })

  it('creates a unit as available without complaint', async () => {
    await createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{ assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' }],
    })

    const unit = attempts[0]?.writes.find((write) => write.path.startsWith('inventory_units/'))
    expect(unit?.data.status).toBe('available')
    expect(unit?.data.using_team_id).toBeUndefined()
  })

  it('refuses an in-use unit with no borrowing team, before any write', async () => {
    await expect(createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{ assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'in_use', storageLocation: 'Shelf' }],
    })).rejects.toThrow(/which team has it/i)

    expect(attempts).toEqual([])
  })

  it('refuses borrowing details on a unit that is not out', async () => {
    await expect(createInventoryUnits({
      teamIds: TEAMS,
      item: SERIALIZED_ITEM,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good',
        status: 'available', storageLocation: 'Shelf', usingTeamId: 'team-costume',
      }],
    })).rejects.toThrow(/only a unit that is in use/i)

    expect(attempts).toEqual([])
  })

  it('refuses a batch over the ceiling, before any write', async () => {
    const many = Array.from({ length: 201 }, (_, index) => ({
      assetCode: `A-${String(index)}`,
      owningTeamId: 'team-lighting',
      condition: 'good' as const,
      status: 'available' as const,
      storageLocation: 'Shelf',
    }))

    await expect(createInventoryUnits({ item: SERIALIZED_ITEM, units: many, teamIds: TEAMS }))
      .rejects.toThrow(/at most 200/i)

    expect(attempts).toEqual([])
  })

  it('refuses to add units to a bulk item', async () => {
    await expect(createInventoryUnits({
      teamIds: TEAMS,
      item: BULK_ITEM,
      units: [{ assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' }],
    })).rejects.toThrow(/quantity rather than individual equipment/i)

    expect(attempts).toEqual([])
  })
})

describe('promoteToSerialized — open maintenance blocks conversion', () => {
  it('converts when the item has no repair history', async () => {
    maintenanceRecords = []

    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    expect(attempts).toHaveLength(1)
  })

  it('converts when every repair is returned or cancelled', async () => {
    maintenanceRecords = [
      { status: 'returned', quantity_sent: 2 },
      { status: 'cancelled', quantity_sent: 1 },
    ]

    await promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS })

    expect(attempts).toHaveLength(1)
  })

  it.each(['planned', 'sent', 'in_service', 'ready'])(
    'refuses to convert while a repair is %s',
    async (status) => {
      maintenanceRecords = [{ status, quantity_sent: 4 }]

      await expect(promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS }))
        .rejects.toThrow(/active maintenance/i)
    },
  )

  it('refuses when one record among several is still open', async () => {
    maintenanceRecords = [
      { status: 'returned', quantity_sent: 2 },
      { status: 'cancelled', quantity_sent: 1 },
      { status: 'in_service', quantity_sent: 4 },
    ]

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS }))
      .rejects.toThrow(/active maintenance/i)
  })

  it('writes no units and does not touch the parent when blocked', async () => {
    // The point of enforcing this in the service: a caller that skipped the
    // wizard entirely still gets nothing written.
    maintenanceRecords = [{ status: 'sent', quantity_sent: 4 }]

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS }))
      .rejects.toThrow()

    expect(attempts).toEqual([])
    expect(looseWrites).toEqual([])
    expect(allocatedIds).toEqual([])
  })

  it('refuses when the repair history cannot be read at all', async () => {
    // Without the maintenance permission there is no way to establish that no
    // repair is open, and converting on that basis would be a guess.
    maintenanceReadFails = true

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS }))
      .rejects.toThrow(/could not be read/i)

    expect(attempts).toEqual([])
  })

  it('names how many repairs are open so the caller can explain it', async () => {
    maintenanceRecords = [
      { status: 'in_service', quantity_sent: 4 },
      { status: 'planned', quantity_sent: 2 },
    ]

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts: fourDrafts(), teamIds: TEAMS }))
      .rejects.toThrow(/2 active maintenance records/i)
  })

  it('checks maintenance before validating the drafts', async () => {
    // Both are wrong here. The maintenance message is the useful one, because
    // fixing the drafts would not make the conversion possible.
    maintenanceRecords = [{ status: 'sent', quantity_sent: 4 }]
    const drafts = fourDrafts()
    drafts[0] = draft({ assetCode: 'CLAMP-001', condition: null })

    await expect(promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS }))
      .rejects.toThrow(/active maintenance/i)
  })
})

describe('unit owning team', () => {
  beforeEach(() => {
    STORED_ITEM = SERIALIZED_ITEM
  })

  it('writes the unit\'s chosen team, not the item\'s', async () => {
    await createInventoryUnits({
      item: SERIALIZED_ITEM,
      teamIds: TEAMS,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-costume', condition: 'good',
        status: 'available', storageLocation: 'Shelf',
      }],
    })

    const unit = attempts[0]?.writes.find((write) => write.path.startsWith('inventory_units/'))
    expect(unit?.data.team_id).toBe('team-costume')
    // The parent still says Lighting; that is now a default, not a claim.
    expect(SERIALIZED_ITEM.team_id).toBe('team-lighting')
  })

  it('gives two units of one item different owning teams', async () => {
    await createInventoryUnits({
      item: SERIALIZED_ITEM,
      teamIds: TEAMS,
      units: [
        { assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' },
        { assetCode: 'A-2', owningTeamId: 'team-costume', condition: 'good', status: 'available', storageLocation: 'Shelf' },
      ],
    })

    const units = attempts[0]?.writes.filter((write) => write.path.startsWith('inventory_units/'))
    expect(units?.map((write) => write.data.team_id)).toEqual(['team-lighting', 'team-costume'])
  })

  it('refuses an owning team the actor cannot assign, before any write', async () => {
    await expect(createInventoryUnits({
      item: SERIALIZED_ITEM,
      teamIds: TEAMS,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-not-mine', condition: 'good',
        status: 'available', storageLocation: 'Shelf',
      }],
    })).rejects.toThrow(/owning team from this organization/i)

    expect(attempts).toEqual([])
    expect(looseWrites).toEqual([])
  })

  it('keeps the lifecycle counts independent of ownership', async () => {
    await createInventoryUnits({
      item: SERIALIZED_ITEM,
      teamIds: TEAMS,
      units: [
        { assetCode: 'A-1', owningTeamId: 'team-lighting', condition: 'good', status: 'available', storageLocation: 'Shelf' },
        { assetCode: 'A-2', owningTeamId: 'team-costume', condition: 'good', status: 'available', storageLocation: 'Shelf' },
      ],
    })

    const parent = attempts[0]?.writes.find((write) => write.path === 'inventory_items/item-1')
    expect(parent?.data.unit_counts).toMatchObject({ available: 2, active_total: 2 })
  })

  it('lets a promotion split an item between crews', async () => {
    STORED_ITEM = BULK_ITEM
    const drafts = fourDrafts().map((one, index) => (
      index < 2 ? one : { ...one, owningTeamId: 'team-costume' }
    ))

    await promoteToSerialized({ item: BULK_ITEM, drafts, teamIds: TEAMS })

    const units = attempts[0]?.writes.filter((write) => write.path.startsWith('inventory_units/'))
    expect(units?.map((write) => write.data.team_id))
      .toEqual(['team-lighting', 'team-lighting', 'team-costume', 'team-costume'])
  })
})

describe('the parent write a unit operation sends', () => {
  beforeEach(() => {
    STORED_ITEM = SERIALIZED_ITEM
  })

  it('changes only the mirror fields, so it travels the cross-team path', async () => {
    // Rules let any inventory editor move these numbers precisely because the
    // write touches nothing else. If a future change starts carrying different
    // metadata here, a Scenic owner editing their unit under a Lighting item
    // would silently start failing — so the shape is asserted, not assumed.
    await createInventoryUnits({
      item: SERIALIZED_ITEM,
      teamIds: TEAMS,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-costume', condition: 'good',
        status: 'available', storageLocation: 'Shelf',
      }],
    })

    const parent = attempts[0]?.writes.find((write) => write.path === 'inventory_items/item-1')
    const data = parent?.data as Record<string, unknown>

    expect(data.name).toBe(SERIALIZED_ITEM.name)
    expect(data.category).toBe(SERIALIZED_ITEM.category)
    expect(data.team_id).toBe(SERIALIZED_ITEM.team_id)
    expect(data.location).toBe(SERIALIZED_ITEM.location)
    expect(data.tracking_mode).toBe('serialized')
    expect(data.created_by_uid).toBe(SERIALIZED_ITEM.created_by_uid)
    expect(data.created_at).toBe(SERIALIZED_ITEM.created_at)
  })

  it('carries the parent\'s own team through untouched when a unit is another crew\'s', async () => {
    await createInventoryUnits({
      item: SERIALIZED_ITEM,
      teamIds: TEAMS,
      units: [{
        assetCode: 'A-1', owningTeamId: 'team-costume', condition: 'good',
        status: 'available', storageLocation: 'Shelf',
      }],
    })

    const parent = attempts[0]?.writes.find((write) => write.path === 'inventory_items/item-1')
    const unit = attempts[0]?.writes.find((write) => write.path.startsWith('inventory_units/'))

    // The item stays Lighting's catalog entry; the unit is Scenic's property.
    expect(parent?.data.team_id).toBe('team-lighting')
    expect(unit?.data.team_id).toBe('team-costume')
  })
})

describe('a metadata edit preserves every maintenance link', () => {
  // Same class of bug as the lifecycle service: a full-document write that
  // omits a field deletes it, and an edit owns none of these.
  const LINKED = unit({
    planned_maintenance_record_id: 'plan-a',
    maintenance_record_ids: ['rec-old-1', 'rec-old-2'],
    last_lifecycle_event_id: 'evt-earlier',
  })

  it('keeps the plan, the history, and the last event through a condition change', async () => {
    STORED_ITEM = SERIALIZED_ITEM

    await updateInventoryUnit({
      existing: LINKED,
      teamIds: TEAMS,
      input: {
        assetCode: LINKED.asset_code,
        owningTeamId: LINKED.team_id,
        condition: 'needs_repair',
        storageLocation: 'Scene Shop',
      },
    })

    const written = attempts[0]?.writes
      .find((write) => write.path.startsWith('inventory_units/'))?.data

    expect(written?.condition).toBe('needs_repair')
    expect(written?.storage_location).toBe('Scene Shop')
    expect(written?.planned_maintenance_record_id).toBe('plan-a')
    expect(written?.maintenance_record_ids).toEqual(['rec-old-1', 'rec-old-2'])
    expect(written?.last_lifecycle_event_id).toBe('evt-earlier')
    // And the status it does not own.
    expect(written?.status).toBe('available')
  })

  it('keeps the current repair link on a unit that is away', async () => {
    const away = unit({
      status: 'in_maintenance',
      current_maintenance_record_id: 'rec-now',
      maintenance_record_ids: ['rec-now'],
    })
    STORED_ITEM = SERIALIZED_ITEM

    await updateInventoryUnit({
      existing: away,
      teamIds: TEAMS,
      input: {
        assetCode: away.asset_code,
        owningTeamId: away.team_id,
        condition: away.condition,
        storageLocation: 'Repair bench',
      },
    })

    const written = attempts[0]?.writes
      .find((write) => write.path.startsWith('inventory_units/'))?.data

    expect(written?.current_maintenance_record_id).toBe('rec-now')
    expect(written?.maintenance_record_ids).toEqual(['rec-now'])
  })
})
