import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch,
  type Firestore, type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { EMPTY_MIRRORS, withUnitsAdded } from '@/domain/inventory-unit'
import {
  ADMIN, CODE_A, ORG_A, TEAM_COSTUME, TEAM_LIGHTING,
  assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Planning a repair, which moves no equipment.
 *
 * The whole point of `planned` is that it is an intention rather than a state:
 * a microphone planned for repair next week can still be used this week. These
 * tests are what keep the planning pointer from quietly becoming a reservation.
 */

let environment: RulesTestEnvironment

const EDITOR = 'uid-plan-editor'
const ITEM = 'itemPLANAAAAAAAAAAAA'
const PLAN = 'planAAAAAAAAAAAAAAAA'
const PLAN_B = 'planBBBBBBBBBBBBBBBB'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

function unitId(index: number) {
  return `unitPL${String(index).padStart(4, '0')}AAAAAAAAA`.slice(0, 20)
}

async function stored(collection: string, id: string) {
  let value = {
    created_at: null as unknown as Timestamp,
    created_by_uid: '',
    status: 'available',
    planned_maintenance_record_id: undefined as string | undefined,
  }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    value = (await getDoc(doc(store, collection, id))).data() as typeof value
  })
  return value
}

async function seedUnits(count: number, statusOf: (index: number) => string = () => 'available') {
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const mirrors = withUnitsAdded(
      EMPTY_MIRRORS,
      Array.from({ length: count }, (_, index) => ({
        status: statusOf(index) as 'available',
        condition: 'good' as const,
      })),
    )

    await setDoc(doc(store, 'inventory_items', ITEM), buildInventoryItemDocument({
      itemId: ITEM, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: {
        name: 'Handheld mic', category: 'Microphones', teamId: TEAM_LIGHTING,
        trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
        quantityTotal: mirrors.quantity_total, quantityAvailable: mirrors.quantity_available,
        conditionCounts: mirrors.condition_counts, location: 'Sound Booth',
      },
    }))

    for (let index = 0; index < count; index += 1) {
      const status = statusOf(index)
      await setDoc(doc(store, 'inventory_units', unitId(index)), buildInventoryUnitDocument({
        unitId: unitId(index), organizationId: ORG_A, inventoryItemId: ITEM,
        uid: ADMIN, now: serverTimestamp,
        input: {
          assetCode: `MIC-${String(index).padStart(3, '0')}`,
          owningTeamId: TEAM_LIGHTING, condition: 'good',
          status: status as 'available',
          storageLocation: 'Sound Booth',
          ...(status === 'in_use' ? { usingTeamId: TEAM_LIGHTING } : {}),
        },
      }))
    }
  })
}

function planDoc(o: { unitIds: string[]; planId?: string; overrides?: Record<string, unknown> }) {
  return {
    maintenance_id: o.planId ?? PLAN,
    organization_id: ORG_A,
    item_id: ITEM,
    team_id: TEAM_LIGHTING,
    tracking_mode: 'serialized',
    unit_ids: o.unitIds,
    quantity_sent: o.unitIds.length,
    issue_description: 'Crackling on channel 2',
    status: 'planned',
    created_by_uid: EDITOR,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    ...(o.overrides ?? {}),
  }
}

/** A unit document carrying only a changed planning pointer. */
async function unitWithPlan(index: number, planId: string | null, extra: Record<string, unknown> = {}) {
  const unit = await stored('inventory_units', unitId(index))
  return {
    unit_id: unitId(index),
    organization_id: ORG_A,
    inventory_item_id: ITEM,
    team_id: TEAM_LIGHTING,
    asset_code: `MIC-${String(index).padStart(3, '0')}`,
    condition: 'good',
    status: unit.status,
    storage_location: 'Sound Booth',
    ...(unit.status === 'in_use' ? { using_team_id: TEAM_LIGHTING } : {}),
    ...(planId ? { planned_maintenance_record_id: planId } : {}),
    created_by_uid: unit.created_by_uid,
    created_at: unit.created_at,
    updated_at: serverTimestamp(),
    ...extra,
  }
}

/** Creating a plan: the record, plus a pointer on each unit. Nothing else. */
async function createPlan(o: {
  uid?: string; count: number; planId?: string
  planOverrides?: Record<string, unknown>
  skipUnits?: boolean
}) {
  const uid = o.uid ?? EDITOR
  const store = db(uid)
  const batch = writeBatch(store)
  const planId = o.planId ?? PLAN
  const ids = Array.from({ length: o.count }, (_, index) => unitId(index))

  batch.set(doc(store, 'maintenance_records', planId), planDoc({
    unitIds: ids, planId, overrides: { ...(o.planOverrides ?? {}), created_by_uid: uid },
  }))

  if (!o.skipUnits) {
    for (let index = 0; index < o.count; index += 1) {
      batch.set(doc(store, 'inventory_units', unitId(index)), await unitWithPlan(index, planId))
    }
  }

  return batch.commit()
}

beforeEach(async () => {
  await environment.clearFirestore()
  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Sound' })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING],
    permissions: { inventory: 'edit', maintenance: 'edit', productions: 'none', calendar: 'none' },
  })
})

describe('a plan moves no equipment', () => {
  it('PL1 creates a plan over three available units', async () => {
    await seedUnits(3)
    await assertSucceeds(createPlan({ count: 3 }))
  })

  it('PL2 plans equipment that is currently in use', async () => {
    // The repair is for later; it can be checked in first.
    await seedUnits(3, (index) => (index === 0 ? 'in_use' : 'available'))
    await assertSucceeds(createPlan({ count: 3 }))
  })

  it('PL3 leaves the parent counts untouched', async () => {
    await seedUnits(3)
    await createPlan({ count: 3 })

    let counts = { in_maintenance: -1, available: -1 }
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_items', ITEM))
      counts = (snapshot.data() as { unit_counts: typeof counts }).unit_counts
    })

    expect(counts.in_maintenance).toBe(0)
    expect(counts.available).toBe(3)
  })

  it('PL4 refuses a plan that also moves the parent count', async () => {
    // A plan claiming equipment left would be a reservation by another name.
    await seedUnits(3)
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const item = await stored('inventory_items', ITEM)
    const ids = [unitId(0), unitId(1), unitId(2)]

    batch.set(doc(store, 'maintenance_records', PLAN), planDoc({ unitIds: ids }))
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'in_maintenance', condition: 'good' },
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'good' },
    ])
    batch.set(doc(store, 'inventory_items', ITEM), {
      item_id: ITEM, organization_id: ORG_A, team_id: TEAM_LIGHTING,
      name: 'Handheld mic', category: 'Microphones', tracking_mode: 'serialized',
      unit_counts: mirrors.unit_counts, quantity_total: mirrors.quantity_total,
      quantity_available: mirrors.quantity_available,
      condition_counts: mirrors.condition_counts, location: 'Sound Booth',
      created_by_uid: item.created_by_uid, created_at: item.created_at,
      updated_at: serverTimestamp(),
    })

    await assertFails(batch.commit())
  })

  it('PL5 refuses a plan that sets the current-repair pointer', async () => {
    await seedUnits(3)
    const store = db(EDITOR)
    const batch = writeBatch(store)

    batch.set(doc(store, 'maintenance_records', PLAN), planDoc({
      unitIds: [unitId(0)],
    }))
    batch.set(doc(store, 'inventory_units', unitId(0)),
      await unitWithPlan(0, PLAN, { current_maintenance_record_id: PLAN }))

    await assertFails(batch.commit())
  })
})

describe('the planning pointer is not a reservation', () => {
  beforeEach(async () => {
    await seedUnits(3)
    await createPlan({ count: 3 })
  })

  it('PL6 a planned unit may still be taken out', async () => {
    // The property this whole design exists to preserve.
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'inventory_units', unitId(0)), {
      status: 'in_use',
      using_team_id: TEAM_LIGHTING,
      last_lifecycle_event_id: 'evtOUTAAAAAAAAAAAAAA',
      updated_at: serverTimestamp(),
    }).catch(async () => {
      // Lifecycle moves need their event; the point here is that the plan does
      // not stand in the way, so the full transaction is what is checked.
      const store = db(EDITOR)
      const batch = writeBatch(store)
      const unit = await stored('inventory_units', unitId(0))

      batch.set(doc(store, 'inventory_units', unitId(0)), {
        ...(await unitWithPlan(0, PLAN)),
        status: 'in_use',
        using_team_id: TEAM_LIGHTING,
        last_lifecycle_event_id: 'evtOUTAAAAAAAAAAAAAA',
        created_by_uid: unit.created_by_uid,
        created_at: unit.created_at,
      })
      batch.set(doc(store, 'asset_events', 'evtOUTAAAAAAAAAAAAAA'), {
        event_id: 'evtOUTAAAAAAAAAAAAAA',
        organization_id: ORG_A,
        inventory_item_id: ITEM,
        inventory_unit_id: unitId(0),
        event_type: 'marked_in_use',
        from_status: 'available',
        to_status: 'in_use',
        using_team_id: TEAM_LIGHTING,
        actor_uid: EDITOR,
        occurred_at: serverTimestamp(),
      })
      return batch.commit()
    }))
  })

  it('PL7 a metadata edit keeps the plan', async () => {
    await assertSucceeds(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWithPlan(0, PLAN, { condition: 'fair', storage_location: 'Repair bench' }),
    ))
  })

  it('PL8 an edit cannot quietly drop the plan', async () => {
    // Losing a plan has to be the plan changing, not a side effect of editing a
    // unit's notes.
    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(0)),
      await unitWithPlan(0, null, { condition: 'fair' }),
    ))
  })

  it('PL9 an edit cannot invent a plan', async () => {
    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(1)),
      await unitWithPlan(1, 'planINVENTEDAAAAAAAA'),
    ))
  })

  it('PL10 a unit cannot point at a plan that does not list it', async () => {
    // The outer plan covers units 0-2. A fourth unit claiming it is refused.
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await setDoc(doc(store, 'inventory_units', unitId(9)), buildInventoryUnitDocument({
        unitId: unitId(9), organizationId: ORG_A, inventoryItemId: ITEM,
        uid: ADMIN, now: serverTimestamp,
        input: {
          assetCode: 'MIC-009', owningTeamId: TEAM_LIGHTING, condition: 'good',
          status: 'available', storageLocation: 'Sound Booth',
        },
      }))
    })

    await assertFails(setDoc(
      doc(db(EDITOR), 'inventory_units', unitId(9)),
      await unitWithPlan(9, PLAN),
    ))
  })

  it('PL11 a unit cannot be planned into two repairs at once', async () => {
    // One plan at a time: the second create finds the pointer already taken.
    await assertFails(createPlan({ count: 1, planId: PLAN_B }))
  })
})

describe('changing and calling off a plan', () => {
  beforeEach(async () => {
    await seedUnits(5)
    await createPlan({ count: 3 })
  })

  it('PL12 swaps equipment while it is still a plan', async () => {
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const record = await stored('maintenance_records', PLAN)

    // Drop MIC-001, add MIC-003.
    batch.set(doc(store, 'maintenance_records', PLAN), {
      ...planDoc({ unitIds: [unitId(0), unitId(2), unitId(3)] }),
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })
    batch.set(doc(store, 'inventory_units', unitId(1)), await unitWithPlan(1, null))
    batch.set(doc(store, 'inventory_units', unitId(3)), await unitWithPlan(3, PLAN))

    await assertSucceeds(batch.commit())
  })

  it('PL13 calls off a plan and releases its equipment', async () => {
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const record = await stored('maintenance_records', PLAN)

    batch.set(doc(store, 'maintenance_records', PLAN), {
      ...planDoc({ unitIds: [unitId(0), unitId(1), unitId(2)] }),
      status: 'cancelled',
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })
    for (let index = 0; index < 3; index += 1) {
      batch.set(doc(store, 'inventory_units', unitId(index)), await unitWithPlan(index, null))
    }

    await assertSucceeds(batch.commit())
  })

  it('PL14 cancelling a plan must not move equipment', async () => {
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const record = await stored('maintenance_records', PLAN)
    const item = await stored('inventory_items', ITEM)

    batch.set(doc(store, 'maintenance_records', PLAN), {
      ...planDoc({ unitIds: [unitId(0), unitId(1), unitId(2)] }),
      status: 'cancelled',
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'in_maintenance', condition: 'good' },
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'good' },
    ])
    batch.set(doc(store, 'inventory_items', ITEM), {
      item_id: ITEM, organization_id: ORG_A, team_id: TEAM_LIGHTING,
      name: 'Handheld mic', category: 'Microphones', tracking_mode: 'serialized',
      unit_counts: mirrors.unit_counts, quantity_total: mirrors.quantity_total,
      quantity_available: mirrors.quantity_available,
      condition_counts: mirrors.condition_counts, location: 'Sound Booth',
      created_by_uid: item.created_by_uid, created_at: item.created_at,
      updated_at: serverTimestamp(),
    })

    await assertFails(batch.commit())
  })
})

describe('batch size for planning', () => {
  it.each([1, 10, 25, 50, 100, 200])('PL15 plans %i units', async (count) => {
    await seedUnits(count)
    await assertSucceeds(createPlan({ count }))
  })

  it('PL16 an admin plans two hundred units', async () => {
    await seedUnits(200)
    await assertSucceeds(createPlan({ uid: ADMIN, count: 200 }))
  })
})

/**
 * The two paths the earlier measurement did not cover.
 *
 * Adding the planning pointer put new logic on every unit write, so editing a
 * plan and starting one both need measuring in their own right — the create
 * path passing says nothing about a transaction that writes different units for
 * different reasons.
 */
describe('editing a plan, measured', () => {
  /** Swap a quarter of a plan's equipment for replacements. */
  async function editPlan(o: { uid?: string; count: number; swap: number }) {
    const uid = o.uid ?? EDITOR
    const store = db(uid)
    const batch = writeBatch(store)
    const record = await stored('maintenance_records', PLAN)

    // Keep the tail, drop the head, add the same number of fresh units.
    const kept = Array.from({ length: o.count - o.swap }, (_, i) => unitId(i + o.swap))
    const added = Array.from({ length: o.swap }, (_, i) => unitId(o.count + i))
    const dropped = Array.from({ length: o.swap }, (_, i) => unitId(i))

    batch.set(doc(store, 'maintenance_records', PLAN), {
      ...planDoc({ unitIds: [...kept, ...added] }),
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })

    for (const id of dropped) {
      const index = Number(id.replace(/\D/g, '').slice(0, 4))
      batch.set(doc(store, 'inventory_units', id), await unitWithPlan(index, null))
    }
    for (const id of added) {
      const index = Number(id.replace(/\D/g, '').slice(0, 4))
      batch.set(doc(store, 'inventory_units', id), await unitWithPlan(index, PLAN))
    }

    return batch.commit()
  }

  it.each([1, 10, 25, 50, 100, 200])(
    'PL17 swaps equipment on a plan of %i units',
    async (count) => {
      // Twice the units, so there are replacements to swap in.
      await seedUnits(count * 2)
      await createPlan({ count })

      const swap = Math.max(1, Math.floor(count / 4))
      await assertSucceeds(editPlan({ count, swap }))
    },
  )

  it('PL18 an admin edits a two-hundred-unit plan', async () => {
    await seedUnits(400)
    await createPlan({ uid: ADMIN, count: 200 })

    await assertSucceeds(editPlan({ uid: ADMIN, count: 200, swap: 50 }))
  })

  it('PL19 an edit leaves the equipment and the parent counts alone', async () => {
    await seedUnits(20)
    await createPlan({ count: 10 })
    await editPlan({ count: 10, swap: 3 })

    let counts = { in_maintenance: -1, available: -1 }
    let dropped = { status: '', planned_maintenance_record_id: undefined as string | undefined }
    let added = { status: '', planned_maintenance_record_id: undefined as string | undefined }

    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      counts = ((await getDoc(doc(store, 'inventory_items', ITEM))).data() as {
        unit_counts: typeof counts
      }).unit_counts
      dropped = (await getDoc(doc(store, 'inventory_units', unitId(0)))).data() as typeof dropped
      added = (await getDoc(doc(store, 'inventory_units', unitId(10)))).data() as typeof added
    })

    expect(counts.in_maintenance).toBe(0)
    expect(counts.available).toBe(20)
    expect(dropped.status).toBe('available')
    expect(dropped.planned_maintenance_record_id).toBeUndefined()
    expect(added.planned_maintenance_record_id).toBe(PLAN)
  })
})

describe('starting a plan, measured', () => {
  /** The full start: record, every unit, the parent, and one shared event. */
  async function startPlan(o: {
    uid?: string; count: number; to: 'sent' | 'in_service' | 'ready'; eventId?: string
  }) {
    const uid = o.uid ?? EDITOR
    const store = db(uid)
    const batch = writeBatch(store)
    const record = await stored('maintenance_records', PLAN)
    const item = await stored('inventory_items', ITEM)
    const eventId = o.eventId ?? 'evtSTARTAAAAAAAAAAAA'
    const ids = Array.from({ length: o.count }, (_, index) => unitId(index))

    batch.set(doc(store, 'maintenance_records', PLAN), {
      ...planDoc({ unitIds: ids }),
      status: o.to,
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })

    for (let index = 0; index < o.count; index += 1) {
      const unit = await stored('inventory_units', unitId(index))
      batch.set(doc(store, 'inventory_units', unitId(index)), {
        unit_id: unitId(index),
        organization_id: ORG_A,
        inventory_item_id: ITEM,
        team_id: TEAM_LIGHTING,
        asset_code: `MIC-${String(index).padStart(3, '0')}`,
        condition: 'good',
        status: 'in_maintenance',
        storage_location: 'Sound Booth',
        last_lifecycle_event_id: eventId,
        current_maintenance_record_id: PLAN,
        maintenance_record_ids: [PLAN],
        // The planning pointer is simply not carried through.
        created_by_uid: unit.created_by_uid,
        created_at: unit.created_at,
        updated_at: serverTimestamp(),
      })
    }

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
        name: 'Handheld mic', category: 'Microphones', teamId: TEAM_LIGHTING,
        trackingMode: 'serialized', unitCounts: mirrors.unit_counts,
        quantityTotal: mirrors.quantity_total,
        quantityAvailable: mirrors.quantity_available,
        conditionCounts: mirrors.condition_counts, location: 'Sound Booth',
      },
    }))

    batch.set(doc(store, 'asset_events', eventId), {
      event_id: eventId,
      organization_id: ORG_A,
      inventory_item_id: ITEM,
      inventory_unit_ids: ids,
      maintenance_record_id: PLAN,
      event_type: 'sent_to_maintenance',
      from_status: 'available',
      to_status: 'in_maintenance',
      actor_uid: uid,
      occurred_at: serverTimestamp(),
    })

    return batch.commit()
  }

  it.each([1, 10, 25, 50, 100, 200])('PL20 starts %i units as sent', async (count) => {
    await seedUnits(count)
    await createPlan({ count })
    await assertSucceeds(startPlan({ count, to: 'sent' }))
  })

  it.each([1, 10, 25, 50, 100, 200])('PL21 starts %i units as in service', async (count) => {
    await seedUnits(count)
    await createPlan({ count })
    await assertSucceeds(startPlan({ count, to: 'in_service' }))
  })

  it.each([1, 10, 25, 50, 100, 200])('PL22 starts %i units as ready', async (count) => {
    await seedUnits(count)
    await createPlan({ count })
    await assertSucceeds(startPlan({ count, to: 'ready' }))
  })

  it.each([50, 200])('PL23 an admin starts %i units', async (count) => {
    await seedUnits(count)
    await createPlan({ uid: ADMIN, count })
    await assertSucceeds(startPlan({ uid: ADMIN, count, to: 'in_service' }))
  })

  it('PL24 a start still refuses a unit that is not available', async () => {
    // The plan reserved nothing, so somebody may have borrowed one meanwhile.
    await seedUnits(3, (index) => (index === 1 ? 'in_use' : 'available'))
    await createPlan({ count: 3 })

    await assertFails(startPlan({ count: 3, to: 'sent' }))
  })
})

describe('a plan survives whatever happens to the equipment', () => {
  beforeEach(async () => {
    await seedUnits(3)
    await createPlan({ count: 3 })
  })

  /** A lifecycle move on a planned unit, with its own event. */
  async function lifecycleMove(o: {
    index: number; to: string; eventType: string; eventId: string
    extra?: Record<string, unknown>
  }) {
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const unit = await stored('inventory_units', unitId(o.index))

    const base = await unitWithPlan(o.index, PLAN)
    // Borrowing details belong to a unit that is out and to nothing else, so a
    // check-in drops them — exactly as the production payload builder does.
    const { using_team_id: _team, checked_out_at: _out, ...withoutLoan } = base as
      Record<string, unknown> & { using_team_id?: string; checked_out_at?: unknown }

    batch.set(doc(store, 'inventory_units', unitId(o.index)), {
      ...(o.to === 'in_use' ? base : withoutLoan),
      status: o.to,
      last_lifecycle_event_id: o.eventId,
      created_by_uid: unit.created_by_uid,
      created_at: unit.created_at,
      ...(o.extra ?? {}),
    })
    batch.set(doc(store, 'asset_events', o.eventId), {
      event_id: o.eventId,
      organization_id: ORG_A,
      inventory_item_id: ITEM,
      inventory_unit_id: unitId(o.index),
      event_type: o.eventType,
      from_status: unit.status,
      to_status: o.to,
      ...(o.to === 'in_use' ? { using_team_id: TEAM_LIGHTING } : {}),
      ...(o.to === 'retired' ? { retirement_reason: 'disposed' } : {}),
      actor_uid: EDITOR,
      occurred_at: serverTimestamp(),
    })

    return batch.commit()
  }

  it('PL25 available + planned becomes in use + planned', async () => {
    await assertSucceeds(lifecycleMove({
      index: 0, to: 'in_use', eventType: 'marked_in_use', eventId: 'evtA1AAAAAAAAAAAAAAA',
      extra: { using_team_id: TEAM_LIGHTING, checked_out_at: serverTimestamp() },
    }))

    const unit = await stored('inventory_units', unitId(0))
    expect(unit.planned_maintenance_record_id).toBe(PLAN)
  })

  it('PL26 in use + planned becomes available + planned', async () => {
    await lifecycleMove({
      index: 0, to: 'in_use', eventType: 'marked_in_use', eventId: 'evtA1AAAAAAAAAAAAAAA',
      extra: { using_team_id: TEAM_LIGHTING, checked_out_at: serverTimestamp() },
    })
    await assertSucceeds(lifecycleMove({
      index: 0, to: 'available', eventType: 'checked_in', eventId: 'evtA2AAAAAAAAAAAAAAA',
    }))

    const unit = await stored('inventory_units', unitId(0))
    expect(unit.planned_maintenance_record_id).toBe(PLAN)
  })

  it('PL26a a lifecycle move that drops the plan is refused', async () => {
    // The control for the browser regression. Rules were right to deny the old
    // payload: silently unlinking a unit from its plan is not something a
    // check-out is allowed to do, and the client was fixed rather than this.
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const unit = await stored('inventory_units', unitId(0))

    batch.set(doc(store, 'inventory_units', unitId(0)), {
      ...(await unitWithPlan(0, null)),
      status: 'in_use',
      using_team_id: TEAM_LIGHTING,
      checked_out_at: serverTimestamp(),
      last_lifecycle_event_id: 'evtDROPAAAAAAAAAAAAA',
      created_by_uid: unit.created_by_uid,
      created_at: unit.created_at,
    })
    batch.set(doc(store, 'asset_events', 'evtDROPAAAAAAAAAAAAA'), {
      event_id: 'evtDROPAAAAAAAAAAAAA',
      organization_id: ORG_A,
      inventory_item_id: ITEM,
      inventory_unit_id: unitId(0),
      event_type: 'marked_in_use',
      from_status: 'available',
      to_status: 'in_use',
      using_team_id: TEAM_LIGHTING,
      actor_uid: EDITOR,
      occurred_at: serverTimestamp(),
    })

    await assertFails(batch.commit())
  })

  it('PL26b a lifecycle move that swaps the plan for another is refused', async () => {
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const unit = await stored('inventory_units', unitId(0))

    batch.set(doc(store, 'inventory_units', unitId(0)), {
      ...(await unitWithPlan(0, 'planOTHERAAAAAAAAAAA')),
      status: 'in_use',
      using_team_id: TEAM_LIGHTING,
      checked_out_at: serverTimestamp(),
      last_lifecycle_event_id: 'evtSWAPAAAAAAAAAAAAA',
      created_by_uid: unit.created_by_uid,
      created_at: unit.created_at,
    })
    batch.set(doc(store, 'asset_events', 'evtSWAPAAAAAAAAAAAAA'), {
      event_id: 'evtSWAPAAAAAAAAAAAAA',
      organization_id: ORG_A,
      inventory_item_id: ITEM,
      inventory_unit_id: unitId(0),
      event_type: 'marked_in_use',
      from_status: 'available',
      to_status: 'in_use',
      using_team_id: TEAM_LIGHTING,
      actor_uid: EDITOR,
      occurred_at: serverTimestamp(),
    })

    await assertFails(batch.commit())
  })

  it('PL27 available + planned becomes lost + planned', async () => {
    await assertSucceeds(lifecycleMove({
      index: 1, to: 'lost', eventType: 'marked_lost', eventId: 'evtA3AAAAAAAAAAAAAAA',
    }))

    const unit = await stored('inventory_units', unitId(1))
    expect(unit.planned_maintenance_record_id).toBe(PLAN)
  })

  it('PL28 a planned unit may still be retired, and keeps the plan', async () => {
    // The plan is not deleted on the unit's behalf. It becomes a plan the user
    // has to resolve, which is what they should see.
    await assertSucceeds(lifecycleMove({
      index: 2, to: 'retired', eventType: 'retired', eventId: 'evtA4AAAAAAAAAAAAAAA',
      extra: { retirement_reason: 'disposed' },
    }))

    const unit = await stored('inventory_units', unitId(2))
    expect(unit.planned_maintenance_record_id).toBe(PLAN)
  })

  it('PL29 a retired unit blocks the start of its plan', async () => {
    await lifecycleMove({
      index: 2, to: 'retired', eventType: 'retired', eventId: 'evtA4AAAAAAAAAAAAAAA',
      extra: { retirement_reason: 'disposed' },
    })

    const store = db(EDITOR)
    const batch = writeBatch(store)
    const record = await stored('maintenance_records', PLAN)

    batch.set(doc(store, 'maintenance_records', PLAN), {
      ...planDoc({ unitIds: [unitId(0), unitId(1), unitId(2)] }),
      status: 'sent',
      created_by_uid: record.created_by_uid,
      created_at: record.created_at,
    })

    await assertFails(batch.commit())
  })
})
