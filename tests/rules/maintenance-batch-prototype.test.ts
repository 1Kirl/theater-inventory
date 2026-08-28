import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, writeBatch,
  type Firestore, type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { EMPTY_MIRRORS, withUnitsAdded } from '@/domain/inventory-unit'
import {
  ADMIN, CODE_A, ORG_A, ORG_B, TEAM_COSTUME, TEAM_LIGHTING,
  assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Sending a batch of equipment for repair, and whether the rules can hold it.
 *
 * The per-unit event shape of Phase 11C costs one document read per unit, which
 * measured out at six units before the access-call budget ran dry. This is the
 * prototype of a shared event: every unit in a batch names the same event, so
 * Rules read it once however large the batch is.
 */

let environment: RulesTestEnvironment

const EDITOR = 'uid-mb-editor'
const COSTUME_EDITOR = 'uid-mb-costume'
const BOTH_TEAMS = 'uid-mb-both'

const ITEM = 'itemMBAAAAAAAAAAAAAA'
const RECORD = 'recMBAAAAAAAAAAAAAAA'
const EVENT = 'evtMBAAAAAAAAAAAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

function unitId(index: number) {
  return `unitMB${String(index).padStart(4, '0')}AAAAAAAAA`.slice(0, 20)
}

async function stored(collection: string, id: string) {
  let value = {
    created_at: null as unknown as Timestamp,
    created_by_uid: '',
    maintenance_record_ids: undefined as string[] | undefined,
  }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    value = (await getDoc(doc(store, collection, id))).data() as typeof value
  })
  return value
}

/** `count` available units under one serialized item. */
async function seedUnits(count: number, teamOf: (index: number) => string = () => TEAM_LIGHTING) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const mirrors = withUnitsAdded(
      EMPTY_MIRRORS,
      Array.from({ length: count }, () => ({
        status: 'available' as const, condition: 'good' as const,
      })),
    )

    await setDoc(doc(store, 'inventory_items', ITEM), buildInventoryItemDocument({
      itemId: ITEM, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: {
        name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
        trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
        quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
        conditionCounts: mirrors.condition_counts, location: 'Lighting Storage A',
      },
    }))

    for (let index = 0; index < count; index += 1) {
      await setDoc(doc(store, 'inventory_units', unitId(index)), buildInventoryUnitDocument({
        unitId: unitId(index), organizationId: ORG_A, inventoryItemId: ITEM,
        uid: ADMIN, now: serverTimestamp,
        input: {
          assetCode: `CLAMP-${String(index).padStart(3, '0')}`,
          owningTeamId: teamOf(index), condition: 'good', status: 'available',
          storageLocation: 'Lighting Storage A',
        },
      }))
    }
  })
}

/** The maintenance record a serialized send creates. */
function recordDoc(o: {
  unitIds: string[]; recordId?: string; actorUid?: string
  overrides?: Record<string, unknown> | undefined
}) {
  return {
    maintenance_id: o.recordId ?? RECORD,
    organization_id: ORG_A,
    item_id: ITEM,
    team_id: TEAM_LIGHTING,
    tracking_mode: 'serialized',
    unit_ids: o.unitIds,
    quantity_sent: o.unitIds.length,
    issue_description: 'Threads stripped',
    status: 'sent',
    created_by_uid: o.actorUid ?? ADMIN,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    ...(o.overrides ?? {}),
  }
}

/** The whole send: units, parent mirrors, the record, and one shared event. */
async function sendBatch(o: {
  uid: string
  count: number
  eventOverrides?: Record<string, unknown>
  unitOverrides?: Record<string, unknown>
  recordOverrides?: Record<string, unknown>
  skipEvent?: boolean
  skipUnits?: boolean
  eventId?: string
  recordId?: string
}) {
  const store = db(o.uid)
  const batch = writeBatch(store)
  const ids = Array.from({ length: o.count }, (_, index) => unitId(index))
  const eventId = o.eventId ?? EVENT
  const recordId = o.recordId ?? RECORD

  if (!o.skipUnits) {
    for (const id of ids) {
      const unit = await stored('inventory_units', id)
      batch.set(doc(store, 'inventory_units', id), {
        unit_id: id,
        organization_id: ORG_A,
        inventory_item_id: ITEM,
        team_id: (await storedTeam(id)),
        asset_code: id,
        condition: 'good',
        status: 'in_maintenance',
        storage_location: 'Lighting Storage A',
        last_lifecycle_event_id: eventId,
        current_maintenance_record_id: recordId,
        maintenance_record_ids: [...(unit.maintenance_record_ids ?? []), recordId],
        created_by_uid: unit.created_by_uid,
        created_at: unit.created_at,
        updated_at: serverTimestamp(),
        ...(o.unitOverrides ?? {}),
      })
    }
  }

  const item = await stored('inventory_items', ITEM)
  const mirrors = withUnitsAdded(
    EMPTY_MIRRORS,
    Array.from({ length: o.count }, () => ({
      status: 'in_maintenance' as const, condition: 'good' as const,
    })),
  )
  batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
    itemId: ITEM, organizationId: ORG_A, createdByUid: item.created_by_uid,
    createdAt: item.created_at, now: serverTimestamp,
    input: {
      name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
      trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
      quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
      conditionCounts: mirrors.condition_counts, location: 'Lighting Storage A',
    },
  }))

  batch.set(doc(store, 'maintenance_records', recordId), recordDoc({
    unitIds: ids, recordId, actorUid: o.uid, overrides: o.recordOverrides,
  }))

  if (!o.skipEvent) {
    batch.set(doc(store, 'asset_events', eventId), {
      event_id: eventId,
      organization_id: ORG_A,
      inventory_item_id: ITEM,
      inventory_unit_ids: ids,
      maintenance_record_id: recordId,
      event_type: 'sent_to_maintenance',
      from_status: 'available',
      to_status: 'in_maintenance',
      actor_uid: o.uid,
      occurred_at: serverTimestamp(),
      ...(o.eventOverrides ?? {}),
    })
  }

  return batch.commit()
}

async function storedTeam(id: string) {
  let team = TEAM_LIGHTING
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_units', id))
    team = (snapshot.data() as { team_id: string }).team_id
  })
  return team
}

beforeEach(async () => {
  await environment.clearFirestore()
  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING],
    permissions: { inventory: 'edit', maintenance: 'edit', productions: 'none', calendar: 'none' },
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME],
    permissions: { inventory: 'edit', maintenance: 'edit', productions: 'none', calendar: 'none' },
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: BOTH_TEAMS, teamIds: [TEAM_LIGHTING, TEAM_COSTUME],
    permissions: { inventory: 'edit', maintenance: 'edit', productions: 'none', calendar: 'none' },
  })
})

describe('the send works at all', () => {
  it('P1 sends three units in one transaction', async () => {
    await seedUnits(3)
    await assertSucceeds(sendBatch({ uid: EDITOR, count: 3 }))
  })

  it('P2 an admin sends the same batch', async () => {
    await seedUnits(3)
    await assertSucceeds(sendBatch({ uid: ADMIN, count: 3 }))
  })
})

describe('F1–F7 — what the shared event must prevent', () => {
  it('F1 a unit cannot enter maintenance with no event', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({ uid: EDITOR, count: 3, skipEvent: true }))
  })

  it('F2 the event cannot be written with no unit transition behind it', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({ uid: EDITOR, count: 3, skipUnits: true }))
  })

  it('F3 the event cannot claim a unit list the record does not agree with', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({
      uid: EDITOR, count: 3,
      eventOverrides: { inventory_unit_ids: [unitId(0), unitId(1)] },
    }))
  })

  it('F4 a unit cannot point at an event that does not list it', async () => {
    await seedUnits(3)
    // The event covers two units; a third rides along claiming the same event.
    await assertFails(sendBatch({
      uid: EDITOR, count: 3,
      eventOverrides: { inventory_unit_ids: [unitId(0), unitId(1)] },
      recordOverrides: { unit_ids: [unitId(0), unitId(1)], quantity_sent: 2 },
    }))
  })

  it('F5 a unit cannot name a maintenance record the event does not', async () => {
    await seedUnits(2)
    await assertFails(sendBatch({
      uid: EDITOR, count: 2,
      unitOverrides: { current_maintenance_record_id: 'recOTHERAAAAAAAAAAAA' },
    }))
  })

  it('F6 a unit cannot be in maintenance with no record named', async () => {
    await seedUnits(2)
    const store = db(EDITOR)
    const unit = await stored('inventory_units', unitId(0))

    await assertFails(setDoc(doc(store, 'inventory_units', unitId(0)), {
      unit_id: unitId(0), organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: 'A', condition: 'good',
      status: 'in_maintenance', storage_location: 'S',
      last_lifecycle_event_id: EVENT,
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    }))
  })

  it('F7 the record pointer cannot survive a return', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    const store = db(EDITOR)
    const unit = await stored('inventory_units', unitId(0))

    // Back to available, still claiming to be at the repair shop.
    await assertFails(setDoc(doc(store, 'inventory_units', unitId(0)), {
      unit_id: unitId(0), organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: 'A', condition: 'good',
      status: 'available', storage_location: 'S',
      last_lifecycle_event_id: 'evtRETURNAAAAAAAAAAA',
      current_maintenance_record_id: RECORD,
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    }))
  })
})

describe('F8–F10 — scope and authorization', () => {
  it('F8 a record cannot reference an item from another organization', async () => {
    await seedUnits(2)
    await seedOrganization(environment, { organizationId: ORG_B, adminUid: 'uid-b', code: 'CODEB1' })

    await assertFails(sendBatch({
      uid: EDITOR, count: 2, recordOverrides: { organization_id: ORG_B },
    }))
  })

  it('F9 a member cannot include a unit owned by a crew they do not manage', async () => {
    // Two clamps: one Lighting's, one Costume's. A Lighting-only editor may not
    // move the Costume one, and the batch is all or nothing.
    await seedUnits(2, (index) => (index === 0 ? TEAM_LIGHTING : TEAM_COSTUME))

    await assertFails(sendBatch({ uid: EDITOR, count: 2 }))
  })

  it('F9a a member on both crews may send the same mixed batch', async () => {
    await seedUnits(2, (index) => (index === 0 ? TEAM_LIGHTING : TEAM_COSTUME))

    await assertSucceeds(sendBatch({ uid: BOTH_TEAMS, count: 2 }))
  })

  it('F10 an admin may send a mixed-team batch', async () => {
    await seedUnits(4, (index) => (index % 2 === 0 ? TEAM_LIGHTING : TEAM_COSTUME))

    await assertSucceeds(sendBatch({ uid: ADMIN, count: 4 }))
  })
})

describe('the record itself', () => {
  it('R1 refuses a quantity that disagrees with the unit list', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({ uid: EDITOR, count: 3, recordOverrides: { quantity_sent: 5 } }))
  })

  it('R2 refuses a serialized record created as planned', async () => {
    await seedUnits(2)
    await assertFails(sendBatch({ uid: EDITOR, count: 2, recordOverrides: { status: 'planned' } }))
  })

  it('R3 refuses an empty unit list', async () => {
    await seedUnits(2)
    await assertFails(sendBatch({
      uid: EDITOR, count: 2, recordOverrides: { unit_ids: [], quantity_sent: 0 },
    }))
  })

  it('R4 will not let the equipment list be rewritten afterwards', async () => {
    await seedUnits(3)
    await sendBatch({ uid: EDITOR, count: 3 })

    const record = await stored('maintenance_records', RECORD)
    await assertFails(setDoc(doc(db(EDITOR), 'maintenance_records', RECORD), {
      ...recordDoc({ unitIds: [unitId(0)] }),
      quantity_sent: 1,
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    }))
  })
})

/**
 * How large a batch the shared event can carry.
 *
 * The per-unit shape stopped at six because each unit read a different event.
 * Here they all read the same one, so the question is whether anything else in
 * the transaction still grows with the batch.
 */
describe('batch size, measured', () => {
  it.each([1, 10, 25, 50, 100, 200])('accepts %i units as an authorized member', async (count) => {
    await seedUnits(count)
    await assertSucceeds(sendBatch({ uid: EDITOR, count }))
  })

  it.each([1, 10, 25, 50, 100, 200])('accepts %i units as an admin', async (count) => {
    await seedUnits(count)
    await assertSucceeds(sendBatch({ uid: ADMIN, count }))
  })

  it.each([50, 200])('accepts a mixed-team batch of %i from an admin', async (count) => {
    await seedUnits(count, (index) => (index % 2 === 0 ? TEAM_LIGHTING : TEAM_COSTUME))
    await assertSucceeds(sendBatch({ uid: ADMIN, count }))
  })

  it('carries 200 units, which is the declared cap rather than a budget limit', async () => {
    // The per-unit shape stopped at six on the access-call budget. This one
    // reaches the ceiling written into the rules — every unit reads the same
    // event, so the cost of the batch stopped growing with it. 240 fails on
    // `size() <= 200`, not on anything Firestore imposes.
    let largest = 0
    for (const count of [50, 100, 150, 200, 240]) {
      await environment.clearFirestore()
      await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
      await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
      await seedMembership(environment, {
        organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING],
        permissions: {
          inventory: 'edit', maintenance: 'edit', productions: 'none', calendar: 'none',
        },
      })
      await seedUnits(count)

      try {
        await sendBatch({ uid: EDITOR, count })
        largest = count
      } catch {
        break
      }
    }

    expect(largest).toBe(200)
  })
})

describe('what the write count looks like at the cap', () => {
  it('a 200-unit send is 203 documents, well inside the 500-write limit', async () => {
    // 200 units + the parent item + the maintenance record + one shared event.
    // The per-unit event shape would have been 402.
    await seedUnits(200)
    await assertSucceeds(sendBatch({ uid: EDITOR, count: 200 }))
  })

  it('refuses a batch over the declared cap', async () => {
    await seedUnits(201)
    await assertFails(sendBatch({ uid: EDITOR, count: 201 }))
  })
})

/**
 * The attack the shared event has to survive.
 *
 * Listing fifty units in the record and the event while moving one of them
 * would leave the maintenance detail, the quantity, the dashboard, and the
 * history all claiming fifty pieces of equipment are at the repair shop while
 * forty-nine sit on the shelf. That is not an exaggerated history; it is a
 * wrong answer to "where is my equipment".
 */
describe('claiming a batch while moving one unit', () => {
  /** Everything a real send writes, except that only `moved` units transition. */
  async function overclaim(o: {
    listed: number; moved: number; uid?: string
    status?: 'sent' | 'in_service' | 'ready'
  }) {
    const uid = o.uid ?? EDITOR
    const store = db(uid)
    const batch = writeBatch(store)
    const ids = Array.from({ length: o.listed }, (_, index) => unitId(index))

    for (let index = 0; index < o.moved; index += 1) {
      const id = unitId(index)
      const unit = await stored('inventory_units', id)
      batch.set(doc(store, 'inventory_units', id), {
        unit_id: id, organization_id: ORG_A, inventory_item_id: ITEM,
        team_id: TEAM_LIGHTING, asset_code: id, condition: 'good',
        status: 'in_maintenance', storage_location: 'Lighting Storage A',
        last_lifecycle_event_id: EVENT, current_maintenance_record_id: RECORD,
        maintenance_record_ids: [...(unit.maintenance_record_ids ?? []), RECORD],
        created_by_uid: unit.created_by_uid, created_at: unit.created_at,
        updated_at: serverTimestamp(),
      })
    }

    // Mirrors that match what actually moved, so the parent is self-consistent.
    const item = await stored('inventory_items', ITEM)
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, [
      ...Array.from({ length: o.moved }, () => ({
        status: 'in_maintenance' as const, condition: 'good' as const,
      })),
      ...Array.from({ length: o.listed - o.moved }, () => ({
        status: 'available' as const, condition: 'good' as const,
      })),
    ])
    batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
      itemId: ITEM, organizationId: ORG_A, createdByUid: item.created_by_uid,
      createdAt: item.created_at, now: serverTimestamp,
      input: {
        name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
        trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
        quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
        conditionCounts: mirrors.condition_counts, location: 'Lighting Storage A',
      },
    }))

    batch.set(doc(store, 'maintenance_records', RECORD), recordDoc({
      unitIds: ids, actorUid: uid,
      ...(o.status ? { overrides: { status: o.status } } : {}),
    }))

    batch.set(doc(store, 'asset_events', EVENT), {
      event_id: EVENT, organization_id: ORG_A, inventory_item_id: ITEM,
      inventory_unit_ids: ids, maintenance_record_id: RECORD,
      event_type: 'sent_to_maintenance', from_status: 'available',
      to_status: 'in_maintenance', actor_uid: uid, occurred_at: serverTimestamp(),
    })

    return batch.commit()
  }

  it('X1 refuses a record claiming ten units when only one moved', async () => {
    await seedUnits(10)
    await assertFails(overclaim({ listed: 10, moved: 1 }))
  })

  it('X2 refuses a claim of ten when nine moved', async () => {
    await seedUnits(10)
    await assertFails(overclaim({ listed: 10, moved: 9 }))
  })

  it('X3 accepts the honest version of the same batch', async () => {
    await seedUnits(10)
    await assertSucceeds(overclaim({ listed: 10, moved: 10 }))
  })

  it.each(['in_service', 'ready'] as const)(
    'X4 holds a batch recorded at %s to every other rule',
    async (status) => {
      // The stage a repair is recorded at changes nothing about what the units,
      // the parent, and the event must prove. Claiming ten while moving one
      // still fails.
      await seedUnits(10)
      await assertFails(overclaim({ listed: 10, moved: 1, status }))
    },
  )
})

/** Bringing a batch back, which Phase 11D does all at once or not at all. */
async function closeBatch(o: {
  uid: string
  listed: number
  moved: number
  to?: 'returned' | 'cancelled'
  eventId?: string
}) {
  const store = db(o.uid)
  const batch = writeBatch(store)
  const ids = Array.from({ length: o.listed }, (_, index) => unitId(index))
  const eventId = o.eventId ?? 'evtRETURNAAAAAAAAAAA'

  for (let index = 0; index < o.moved; index += 1) {
    const id = unitId(index)
    const unit = await stored('inventory_units', id)
    batch.set(doc(store, 'inventory_units', id), {
      unit_id: id, organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: id, condition: 'good',
      status: 'available', storage_location: 'Lighting Storage A',
      last_lifecycle_event_id: eventId,
      maintenance_record_ids: unit.maintenance_record_ids ?? [],
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    })
  }

  const item = await stored('inventory_items', ITEM)
  const mirrors = withUnitsAdded(EMPTY_MIRRORS, [
    ...Array.from({ length: o.moved }, () => ({
      status: 'available' as const, condition: 'good' as const,
    })),
    ...Array.from({ length: o.listed - o.moved }, () => ({
      status: 'in_maintenance' as const, condition: 'good' as const,
    })),
  ])
  batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
    itemId: ITEM, organizationId: ORG_A, createdByUid: item.created_by_uid,
    createdAt: item.created_at, now: serverTimestamp,
    input: {
      name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
      trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
      quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
      conditionCounts: mirrors.condition_counts, location: 'Lighting Storage A',
    },
  }))

  const record = await stored('maintenance_records', RECORD)
  batch.set(doc(store, 'maintenance_records', RECORD), {
    ...recordDoc({ unitIds: ids, actorUid: o.uid }),
    status: o.to ?? 'returned',
    created_by_uid: record.created_by_uid,
    created_at: record.created_at,
  })

  batch.set(doc(store, 'asset_events', eventId), {
    event_id: eventId, organization_id: ORG_A, inventory_item_id: ITEM,
    inventory_unit_ids: ids, maintenance_record_id: RECORD,
    event_type: 'returned_from_maintenance', from_status: 'in_maintenance',
    to_status: 'available', actor_uid: o.uid, occurred_at: serverTimestamp(),
  })

  return batch.commit()
}

describe('bringing the batch back', () => {
  beforeEach(async () => {
    await seedUnits(10)
    await sendBatch({ uid: EDITOR, count: 10 })
  })

  it('Y1 returns all ten together', async () => {
    await assertSucceeds(closeBatch({ uid: EDITOR, listed: 10, moved: 10 }))
  })

  it('Y2 cancels all ten together', async () => {
    await assertSucceeds(closeBatch({ uid: EDITOR, listed: 10, moved: 10, to: 'cancelled' }))
  })

  it('Y3 refuses a return that brings back only one of ten', async () => {
    // The same over-claim, read backwards: the record says the repair is over
    // while nine pieces are still at the shop.
    await assertFails(closeBatch({ uid: EDITOR, listed: 10, moved: 1 }))
  })

  it('Y4 refuses a return that brings back nine of ten', async () => {
    await assertFails(closeBatch({ uid: EDITOR, listed: 10, moved: 9 }))
  })

  it('Y5 refuses a workflow step that quietly moves equipment', async () => {
    // sent → in_service is paperwork; the equipment stays where it is.
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const ids = Array.from({ length: 10 }, (_, index) => unitId(index))
    const record = await stored('maintenance_records', RECORD)
    const item = await stored('inventory_items', ITEM)

    const mirrors = withUnitsAdded(EMPTY_MIRRORS, Array.from({ length: 10 }, (_, index) => ({
      status: index === 0 ? ('available' as const) : ('in_maintenance' as const),
      condition: 'good' as const,
    })))
    batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
      itemId: ITEM, organizationId: ORG_A, createdByUid: item.created_by_uid,
      createdAt: item.created_at, now: serverTimestamp,
      input: {
        name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
        trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
        quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
        conditionCounts: mirrors.condition_counts, location: 'Lighting Storage A',
      },
    }))
    batch.set(doc(store, 'maintenance_records', RECORD), {
      ...recordDoc({ unitIds: ids, actorUid: EDITOR }),
      status: 'in_service',
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })

    await assertFails(batch.commit())
  })

  it('Y6 accepts a workflow step that leaves the equipment alone', async () => {
    const store = db(EDITOR)
    const ids = Array.from({ length: 10 }, (_, index) => unitId(index))
    const record = await stored('maintenance_records', RECORD)

    await assertSucceeds(setDoc(doc(store, 'maintenance_records', RECORD), {
      ...recordDoc({ unitIds: ids, actorUid: EDITOR }),
      status: 'in_service',
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    }))
  })
})

describe('identity mismatches between the record, the event, and the units', () => {
  it('M-A refuses a list holding one unit that did not move', async () => {
    // Nine of the ten really transitioned; the tenth id belongs to a unit that
    // stayed on the shelf, so the parent delta is nine against a list of ten.
    await seedUnits(11)
    await assertFails(sendBatch({
      uid: EDITOR, count: 9,
      recordOverrides: {
        unit_ids: [...Array.from({ length: 9 }, (_, i) => unitId(i)), unitId(10)],
        quantity_sent: 10,
      },
      eventOverrides: {
        inventory_unit_ids: [...Array.from({ length: 9 }, (_, i) => unitId(i)), unitId(10)],
      },
    }))
  })

  it('M-B refuses an event listing a different set than the record', async () => {
    await seedUnits(10)
    await assertFails(sendBatch({
      uid: EDITOR, count: 10,
      eventOverrides: {
        inventory_unit_ids: Array.from({ length: 10 }, (_, i) => unitId(9 - i)),
      },
    }))
  })

  it('M-C refuses duplicated unit ids padding the count', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({
      uid: EDITOR, count: 1,
      recordOverrides: { unit_ids: [unitId(0), unitId(0), unitId(0)], quantity_sent: 3 },
      eventOverrides: { inventory_unit_ids: [unitId(0), unitId(0), unitId(0)] },
    }))
  })

  it('M-D refuses a quantity larger than the list', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({
      uid: EDITOR, count: 3, recordOverrides: { quantity_sent: 4 },
    }))
  })

  it('M-E refuses a parent delta smaller than the list', async () => {
    await seedUnits(10)
    await assertFails(overclaimDelta({ listed: 10, delta: 9 }))
  })

  it('M-F refuses a parent delta larger than the list', async () => {
    await seedUnits(10)
    await assertFails(overclaimDelta({ listed: 3, delta: 5 }))
  })
})

/** Units and record agree; the parent's own count is the thing that lies. */
async function overclaimDelta(o: { listed: number; delta: number }) {
  const store = db(EDITOR)
  const batch = writeBatch(store)
  const ids = Array.from({ length: o.listed }, (_, index) => unitId(index))

  for (const id of ids) {
    const unit = await stored('inventory_units', id)
    batch.set(doc(store, 'inventory_units', id), {
      unit_id: id, organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: id, condition: 'good',
      status: 'in_maintenance', storage_location: 'Lighting Storage A',
      last_lifecycle_event_id: EVENT, current_maintenance_record_id: RECORD,
      maintenance_record_ids: [...(unit.maintenance_record_ids ?? []), RECORD],
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    })
  }

  const item = await stored('inventory_items', ITEM)
  const total = 10
  const mirrors = withUnitsAdded(EMPTY_MIRRORS, [
    ...Array.from({ length: o.delta }, () => ({
      status: 'in_maintenance' as const, condition: 'good' as const,
    })),
    ...Array.from({ length: total - o.delta }, () => ({
      status: 'available' as const, condition: 'good' as const,
    })),
  ])
  batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
    itemId: ITEM, organizationId: ORG_A, createdByUid: item.created_by_uid,
    createdAt: item.created_at, now: serverTimestamp,
    input: {
      name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
      trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
      quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
      conditionCounts: mirrors.condition_counts, location: 'Lighting Storage A',
    },
  }))

  batch.set(doc(store, 'maintenance_records', RECORD), recordDoc({
    unitIds: ids, actorUid: EDITOR,
  }))
  batch.set(doc(store, 'asset_events', EVENT), {
    event_id: EVENT, organization_id: ORG_A, inventory_item_id: ITEM,
    inventory_unit_ids: ids, maintenance_record_id: RECORD,
    event_type: 'sent_to_maintenance', from_status: 'available',
    to_status: 'in_maintenance', actor_uid: EDITOR, occurred_at: serverTimestamp(),
  })

  return batch.commit()
}

/**
 * The repair history a unit carries on itself.
 *
 * Append-only, one entry per visit, added when the equipment leaves. This is
 * what lets a unit page answer "has this clamp been repaired before" from the
 * unit alone — no collection search, no unverified array-contains query, and no
 * index.
 */
describe('per-unit maintenance history', () => {
  const RECORD_B = 'recSECONDAAAAAAAAAAA'
  const EVENT_B = 'evtSECONDAAAAAAAAAAA'

  async function historyOf(id: string) {
    let value: string[] = []
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_units', id))
      value = (snapshot.data() as { maintenance_record_ids?: string[] })
        .maintenance_record_ids ?? []
    })
    return value
  }

  /** The unit document a write would leave behind. */
  async function unitWith(o: {
    status: 'available' | 'in_maintenance'
    history: string[]
    currentRecord?: string | null
    eventId: string
  }) {
    const unit = await stored('inventory_units', unitId(0))
    return {
      unit_id: unitId(0), organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: unitId(0), condition: 'good',
      status: o.status, storage_location: 'Lighting Storage A',
      last_lifecycle_event_id: o.eventId,
      ...(o.currentRecord ? { current_maintenance_record_id: o.currentRecord } : {}),
      maintenance_record_ids: o.history,
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    }
  }

  it('H1 the first repair puts one record on the unit', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    expect(await historyOf(unitId(0))).toEqual([RECORD])
  })

  it('H2 a second repair appends rather than replacing', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })
    await closeBatch({ uid: EDITOR, listed: 2, moved: 2 })
    await sendBatch({ uid: EDITOR, count: 2, recordId: RECORD_B, eventId: EVENT_B })

    expect(await historyOf(unitId(0))).toEqual([RECORD, RECORD_B])
  })

  it('H3 refuses an arbitrary record appended out of nowhere', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    // A metadata edit that quietly claims another repair happened.
    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWith({
        status: 'in_maintenance', history: [RECORD, 'recINVENTEDAAAAAAAAA'],
        currentRecord: RECORD, eventId: EVENT,
      }),
    ))
  })

  it('H4 refuses dropping a repair that happened', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWith({
        status: 'in_maintenance', history: [], currentRecord: RECORD, eventId: EVENT,
      }),
    ))
  })

  it('H5 refuses rewriting an earlier repair as a different one', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWith({
        status: 'in_maintenance', history: ['recSOMETHINGELSEAAAA'],
        currentRecord: RECORD, eventId: EVENT,
      }),
    ))
  })

  it('H6 refuses the same repair recorded twice', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWith({
        status: 'in_maintenance', history: [RECORD, RECORD],
        currentRecord: RECORD, eventId: EVENT,
      }),
    ))
  })

  it('H7 a metadata edit cannot touch the history', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })
    await closeBatch({ uid: EDITOR, listed: 2, moved: 2 })

    // Changing where it is kept, while slipping in a repair that never was.
    const unit = await stored('inventory_units', unitId(0))
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_units', unitId(0)), {
      unit_id: unitId(0), organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: unitId(0), condition: 'fair',
      status: 'available', storage_location: 'Scene Shop',
      last_lifecycle_event_id: 'evtRETURNAAAAAAAAAAA',
      maintenance_record_ids: [RECORD, 'recINVENTEDAAAAAAAAA'],
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    }))
  })

  it('H8 a metadata edit that leaves the history alone is fine', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })
    await closeBatch({ uid: EDITOR, listed: 2, moved: 2 })

    const unit = await stored('inventory_units', unitId(0))
    await assertSucceeds(setDoc(doc(db(EDITOR), 'inventory_units', unitId(0)), {
      unit_id: unitId(0), organization_id: ORG_A, inventory_item_id: ITEM,
      team_id: TEAM_LIGHTING, asset_code: unitId(0), condition: 'fair',
      status: 'available', storage_location: 'Scene Shop',
      last_lifecycle_event_id: 'evtRETURNAAAAAAAAAAA',
      maintenance_record_ids: [RECORD],
      created_by_uid: unit.created_by_uid, created_at: unit.created_at,
      updated_at: serverTimestamp(),
    }))
  })

  it('H9 returning keeps the history and clears the current pointer', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })
    await closeBatch({ uid: EDITOR, listed: 2, moved: 2 })

    expect(await historyOf(unitId(0))).toEqual([RECORD])

    let current: string | undefined
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_units', unitId(0)))
      current = (snapshot.data() as { current_maintenance_record_id?: string })
        .current_maintenance_record_id
    })
    expect(current).toBeUndefined()
  })

  it('H10 cancelling keeps the history too', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })
    await closeBatch({ uid: EDITOR, listed: 2, moved: 2, to: 'cancelled' })

    expect(await historyOf(unitId(0))).toEqual([RECORD])
  })

  it('H11 a return cannot quietly erase the history', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWith({
        status: 'available', history: [], eventId: 'evtRETURNAAAAAAAAAAA',
      }),
    ))
  })

  it('H12 a return cannot append a second repair', async () => {
    await seedUnits(2)
    await sendBatch({ uid: EDITOR, count: 2 })

    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWith({
        status: 'available', history: [RECORD, RECORD_B],
        eventId: 'evtRETURNAAAAAAAAAAA',
      }),
    ))
  })
})

/**
 * Where a repair may be recorded as starting.
 *
 * Equipment sent on Monday and entered on Wednesday is already being worked on,
 * and the record has to be able to say so. What it cannot say is that the
 * repair has not begun, or that it is already over.
 */
describe('the stage a repair is recorded at', () => {
  it.each(['sent', 'in_service', 'ready'] as const)('accepts creation at %s', async (status) => {
    await seedUnits(3)
    await assertSucceeds(sendBatch({
      uid: EDITOR, count: 3, recordOverrides: { status },
    }))
  })

  it('refuses creation as planned', async () => {
    await seedUnits(3)
    await assertFails(sendBatch({
      uid: EDITOR, count: 3, recordOverrides: { status: 'planned' },
    }))
  })

  it.each(['returned', 'cancelled'] as const)(
    'refuses creation as %s',
    async (status) => {
      await seedUnits(3)
      await assertFails(sendBatch({
        uid: EDITOR, count: 3, recordOverrides: { status },
      }))
    },
  )
})

/**
 * The batch budget, re-measured after the creation rule changed.
 */
describe('batch size at each creation stage', () => {
  it.each(['sent', 'in_service', 'ready'] as const)(
    'carries 200 units created at %s, as a member',
    async (status) => {
      await seedUnits(200)
      await assertSucceeds(sendBatch({
        uid: EDITOR, count: 200, recordOverrides: { status },
      }))
    },
  )

  it.each(['sent', 'in_service', 'ready'] as const)(
    'carries 200 units created at %s, as an admin',
    async (status) => {
      await seedUnits(200)
      await assertSucceeds(sendBatch({
        uid: ADMIN, count: 200, recordOverrides: { status },
      }))
    },
  )

  it('carries 200 units across two crews for an admin', async () => {
    await seedUnits(200, (index) => (index % 2 === 0 ? TEAM_LIGHTING : TEAM_COSTUME))
    await assertSucceeds(sendBatch({
      uid: ADMIN, count: 200, recordOverrides: { status: 'in_service' },
    }))
  })
})
