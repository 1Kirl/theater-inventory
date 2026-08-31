import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  Timestamp, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { buildAssetEventDocument } from '@/domain/asset-event-payloads'
import { buildMaintenanceDocument } from '@/domain/maintenance-payloads'
import { buildCalendarEventDocument } from '@/domain/calendar-payloads'
import {
  buildActionItemDocument, buildProductionDocument, buildRequirementDocument,
} from '@/domain/production-payloads'
import { EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS } from '@/domain/inventory'
import {
  ADMIN, CODE_A, CODE_B, ORG_A, ORG_B, OUTSIDER, TEAM_LIGHTING, TEAM_OTHER_ORG,
  assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Extension D: permission alone never opens a module.
 *
 * Removing somebody's last team is how an Admin takes their access away, and
 * the permission map is deliberately left behind when that happens — it is the
 * only record of what they had, and it is what an Admin sees when putting them
 * back. So a membership can sit in a state no interface ever offers as a
 * choice: active, no team, `inventory: 'view'` still stored.
 *
 * `effectiveRole()` calls that person Unassigned. Rules used to call them a
 * reader, because every `canView*` helper asked `isActiveMemberOf` and the
 * module level, and never whether the membership carried a team. The interface
 * and the authorization boundary disagreed about the same person, and Rules are
 * the only boundary this product has.
 *
 * What follows pins both sides of the line for all four modules, on every
 * collection each one governs.
 */

let environment: RulesTestEnvironment

/** Active, no team, every module granted. The state this file exists for. */
const RESIDUAL = 'uid-ab-residual'
/** Active, one team, every module at view. An ordinary Member. */
const ASSIGNED_VIEW = 'uid-ab-assigned-view'
/** Active, one team, every module at edit. */
const ASSIGNED_EDIT = 'uid-ab-assigned-edit'
/** Active, one team, no module at all. Assigned but not to this module. */
const NO_PERMISSION = 'uid-ab-no-permission'
/** Deactivated, one team, every module granted. */
const INACTIVE = 'uid-ab-inactive'

const ALL_VIEW = {
  inventory: 'view', maintenance: 'view', productions: 'view', calendar: 'view',
} as const
const ALL_EDIT = {
  inventory: 'edit', maintenance: 'edit', productions: 'edit', calendar: 'edit',
} as const
const ALL_NONE = {
  inventory: 'none', maintenance: 'none', productions: 'none', calendar: 'none',
} as const

const ITEM = 'itemABBOUNDARYAAAAA1'
const UNIT = 'unitABBOUNDARYAAAAA1'
const EVENT = 'evntABBOUNDARYAAAAA1'
const MAINT = 'mntABBOUNDARYAAAAAA1'
const PROD = 'prodABBOUNDARYAAAAA1'
const REQ = 'reqABBOUNDARYAAAAAA1'
const ACTION = REQ
const CAL = 'calABBOUNDARYAAAAAA1'

/** The same eight documents again, owned by the other organization. */
const ITEM_B = 'itemABOTHERORGBBBBB1'
const UNIT_B = 'unitABOTHERORGBBBBB1'

const NEW_PROD = 'prodABNEWCCCCCCCCCC1'
const NEW_CAL = 'calABNEWDDDDDDDDDDD1'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function read(uid: string | null, collection: string, id: string) {
  return getDoc(doc(db(uid), collection, id))
}

/**
 * Serialized, because a unit hangs off it below and because the mirror-update
 * path — the one write `canUpdateSerializedMirrors` governs — does not exist
 * for a bulk item at all. A bulk fixture would make that test pass for the
 * wrong reason.
 */
function itemDoc(itemId: string, organizationId: string, teamId: string) {
  return buildInventoryItemDocument({
    itemId, organizationId, uid: ADMIN, now: serverTimestamp,
    input: {
      name: 'Wireless Microphone', category: 'Microphones', teamId,
      trackingMode: 'serialized',
      unitCounts: { ...EMPTY_UNIT_COUNTS, active_total: 1, available: 1 },
      quantityTotal: 1, quantityAvailable: 1,
      conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 1 }, location: 'Booth',
    },
  })
}

function unitDoc(unitId: string, organizationId: string, itemId: string, teamId: string) {
  return buildInventoryUnitDocument({
    unitId, organizationId, inventoryItemId: itemId, uid: ADMIN, now: serverTimestamp,
    input: {
      owningTeamId: teamId, assetCode: 'MIC-001', condition: 'good', status: 'available',
      storageLocation: 'Booth', retirementReason: null, usingTeamId: null, usingMemberUid: null,
    },
  })
}

function calendarDoc(eventId: string, organizationId: string, uid = ADMIN) {
  return buildCalendarEventDocument({
    eventId, organizationId, uid, now: serverTimestamp,
    input: {
      title: 'Dress Rehearsal', eventType: 'Rehearsal',
      eventDate: Timestamp.fromDate(new Date(2026, 7, 24)),
      visibility: 'all_teams', teamIds: [],
    },
  })
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Other' })

  // The Admin keeps the seed default: no team, no permission. Administration is
  // `organizations.admin_uid` and nothing else, and these tests are the proof.
  await seedMembership(environment, {
    organizationId: ORG_A, uid: RESIDUAL, teamIds: [], permissions: ALL_EDIT,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: ASSIGNED_VIEW, teamIds: [TEAM_LIGHTING], permissions: ALL_VIEW,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: ASSIGNED_EDIT, teamIds: [TEAM_LIGHTING], permissions: ALL_EDIT,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: NO_PERMISSION, teamIds: [TEAM_LIGHTING], permissions: ALL_NONE,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: INACTIVE, teamIds: [TEAM_LIGHTING], permissions: ALL_EDIT,
    isActive: false,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const s = context.firestore() as unknown as Firestore

    await setDoc(doc(s, 'inventory_items', ITEM), itemDoc(ITEM, ORG_A, TEAM_LIGHTING))
    await setDoc(doc(s, 'inventory_units', UNIT), unitDoc(UNIT, ORG_A, ITEM, TEAM_LIGHTING))
    await setDoc(doc(s, 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT, organizationId: ORG_A, inventoryItemId: ITEM, inventoryUnitId: UNIT,
      uid: ADMIN, now: serverTimestamp,
      input: {
        eventType: 'marked_in_use', fromStatus: 'available', toStatus: 'in_use',
        usingTeamId: TEAM_LIGHTING, retirementReason: null,
      },
    }))

    await setDoc(doc(s, 'maintenance_records', MAINT), buildMaintenanceDocument({
      maintenanceId: MAINT, organizationId: ORG_A, itemId: ITEM, teamId: TEAM_LIGHTING,
      uid: ADMIN, now: serverTimestamp,
      input: {
        quantitySent: 1, issueDescription: 'Lamp housing cracked', status: 'sent',
        serviceProviderName: 'City Stage Service',
      },
    }))

    await setDoc(doc(s, 'productions', PROD), buildProductionDocument({
      productionId: PROD, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: { title: 'Spring Musical', status: 'planning' },
    }))
    await setDoc(doc(s, 'production_requirements', REQ), buildRequirementDocument({
      requirementId: REQ, organizationId: ORG_A, productionId: PROD, uid: ADMIN,
      now: serverTimestamp,
      input: {
        itemName: 'Wireless Microphone', inventoryItemId: ITEM, requiredQty: 4,
        teamId: TEAM_LIGHTING,
      },
    }))
    await setDoc(doc(s, 'action_items', ACTION), buildActionItemDocument({
      requirementId: REQ, organizationId: ORG_A, productionId: PROD,
      itemName: 'Wireless Microphone', teamId: TEAM_LIGHTING, uid: ADMIN, now: serverTimestamp,
      input: { actionType: 'rent', quantity: 3, status: 'todo' },
    }))

    await setDoc(doc(s, 'calendar_events', CAL), calendarDoc(CAL, ORG_A))

    await setDoc(doc(s, 'inventory_items', ITEM_B), itemDoc(ITEM_B, ORG_B, TEAM_OTHER_ORG))
    await setDoc(doc(s, 'inventory_units', UNIT_B), unitDoc(UNIT_B, ORG_B, ITEM_B, TEAM_OTHER_ORG))
  })
})

/**
 * The four modules and the collections each one governs, so the matrix below
 * covers every read path a `canView*` helper guards rather than one per module.
 */
interface ReadPath { collection: string; id: string }

const MODULES: { module: string; reads: ReadPath[] }[] = [
  {
    module: 'inventory',
    reads: [
      { collection: 'inventory_items', id: ITEM },
      { collection: 'inventory_units', id: UNIT },
      { collection: 'asset_events', id: EVENT },
    ],
  },
  {
    module: 'maintenance',
    reads: [{ collection: 'maintenance_records', id: MAINT }],
  },
  {
    module: 'productions',
    reads: [
      { collection: 'productions', id: PROD },
      { collection: 'production_requirements', id: REQ },
      { collection: 'action_items', id: ACTION },
    ],
  },
  {
    module: 'calendar',
    reads: [{ collection: 'calendar_events', id: CAL }],
  },
]

describe.each(MODULES)('$module reads', ({ reads }) => {
  it.each(reads)('denies $collection to an active member with the permission but no team', async ({ collection, id }) => {
    await assertFails(read(RESIDUAL, collection, id))
  })

  it.each(reads)('allows $collection to an assigned member at view', async ({ collection, id }) => {
    await assertSucceeds(read(ASSIGNED_VIEW, collection, id))
  })

  it.each(reads)('allows $collection to an assigned member at edit', async ({ collection, id }) => {
    await assertSucceeds(read(ASSIGNED_EDIT, collection, id))
  })

  it.each(reads)('denies $collection to an assigned member without the module', async ({ collection, id }) => {
    await assertFails(read(NO_PERMISSION, collection, id))
  })

  it.each(reads)('denies $collection to a deactivated membership', async ({ collection, id }) => {
    await assertFails(read(INACTIVE, collection, id))
  })

  it.each(reads)('allows $collection to the Admin, who has neither team nor permission', async ({ collection, id }) => {
    await assertSucceeds(read(ADMIN, collection, id))
  })

  it.each(reads)('denies $collection to the other organization', async ({ collection, id }) => {
    await assertFails(read(OUTSIDER, collection, id))
  })

  it.each(reads)('denies $collection to nobody at all', async ({ collection, id }) => {
    await assertFails(read(null, collection, id))
  })
})

/**
 * The QR label's destination.
 *
 * `/equipment/:unitId` is the one route outside the active organization's
 * guards, so the unit document is the only thing standing between a printed
 * label and the equipment record behind it.
 */
describe('the equipment deep link', () => {
  it('refuses the unit behind a scanned label to residual inventory permission', async () => {
    await assertFails(read(RESIDUAL, 'inventory_units', UNIT))
  })

  it('refuses the unit its parent item too, so the page cannot fill in around it', async () => {
    await assertFails(read(RESIDUAL, 'inventory_items', ITEM))
  })

  it('refuses its lifecycle history', async () => {
    await assertFails(read(RESIDUAL, 'asset_events', EVENT))
  })

  it('still opens for an assigned member of the owning organization', async () => {
    await assertSucceeds(read(ASSIGNED_VIEW, 'inventory_units', UNIT))
  })

  it('still opens for the owning organization Admin', async () => {
    await assertSucceeds(read(ADMIN, 'inventory_units', UNIT))
  })

  it('refuses a unit belonging to an organization the reader is assigned in elsewhere', async () => {
    await assertFails(read(ASSIGNED_VIEW, 'inventory_units', UNIT_B))
  })
})

/**
 * Writes.
 *
 * Team-scoped writes were already closed to a residual membership: an empty
 * `team_ids` matches no team, so `canWriteInventoryForTeam` and its siblings
 * denied them before this change and deny them after it. The two
 * organization-level edit helpers were not — `canEditProductions` and
 * `canEditCalendar` ask only for the module — and neither was the serialized
 * mirror update. Those three are what the write half of this fix closes.
 */
describe('writes by a residual membership', () => {
  it('refuses to create a production', async () => {
    await assertFails(setDoc(doc(db(RESIDUAL), 'productions', NEW_PROD), buildProductionDocument({
      productionId: NEW_PROD, organizationId: ORG_A, uid: RESIDUAL, now: serverTimestamp,
      input: { title: 'Fall Play', status: 'planning' },
    })))
  })

  it('refuses to rename an existing production', async () => {
    await assertFails(updateDoc(doc(db(RESIDUAL), 'productions', PROD), {
      title: 'Renamed', updated_at: serverTimestamp(),
    }))
  })

  it('refuses to create a calendar event', async () => {
    await assertFails(setDoc(doc(db(RESIDUAL), 'calendar_events', NEW_CAL),
      calendarDoc(NEW_CAL, ORG_A, RESIDUAL)))
  })

  it('refuses to delete a calendar event', async () => {
    await assertFails(deleteDoc(doc(db(RESIDUAL), 'calendar_events', CAL)))
  })

  it('refuses to adjust a serialized item’s mirrored counts', async () => {
    await assertFails(updateDoc(doc(db(RESIDUAL), 'inventory_items', ITEM), {
      unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 1, in_use: 1 },
      quantity_total: 1,
      quantity_available: 0,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 1 },
      updated_at: serverTimestamp(),
    }))
  })

  it('lets an assigned inventory editor make that same mirror update', async () => {
    await assertSucceeds(updateDoc(doc(db(ASSIGNED_EDIT), 'inventory_items', ITEM), {
      unit_counts: { ...EMPTY_UNIT_COUNTS, active_total: 1, in_use: 1 },
      quantity_total: 1,
      quantity_available: 0,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 1 },
      updated_at: serverTimestamp(),
    }))
  })

  it('refuses to create an inventory item, as it always did', async () => {
    await assertFails(setDoc(doc(db(RESIDUAL), 'inventory_items', 'itemABRESIDUALEEEEE1'),
      itemDoc('itemABRESIDUALEEEEE1', ORG_A, TEAM_LIGHTING)))
  })
})

/** The same writes by the people who are supposed to be able to make them. */
describe('writes that must keep working', () => {
  it('lets an assigned editor create a production', async () => {
    await assertSucceeds(setDoc(doc(db(ASSIGNED_EDIT), 'productions', NEW_PROD),
      buildProductionDocument({
        productionId: NEW_PROD, organizationId: ORG_A, uid: ASSIGNED_EDIT, now: serverTimestamp,
        input: { title: 'Fall Play', status: 'planning' },
      })))
  })

  it('lets an assigned editor create a calendar event', async () => {
    await assertSucceeds(setDoc(doc(db(ASSIGNED_EDIT), 'calendar_events', NEW_CAL),
      buildCalendarEventDocument({
        eventId: NEW_CAL, organizationId: ORG_A, uid: ASSIGNED_EDIT, now: serverTimestamp,
        input: {
          title: 'Tech Run', eventType: 'Rehearsal',
          eventDate: Timestamp.fromDate(new Date(2026, 7, 25)),
          visibility: 'all_teams', teamIds: [],
        },
      })))
  })

  it('lets an assigned editor delete a calendar event', async () => {
    await assertSucceeds(deleteDoc(doc(db(ASSIGNED_EDIT), 'calendar_events', CAL)))
  })

  it('lets the Admin create a production without belonging to any team', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'productions', NEW_PROD), buildProductionDocument({
      productionId: NEW_PROD, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: { title: 'Fall Play', status: 'planning' },
    })))
  })

  it('lets the Admin create a calendar event without belonging to any team', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'calendar_events', NEW_CAL),
      calendarDoc(NEW_CAL, ORG_A)))
  })
})

/**
 * What a residual membership keeps.
 *
 * Being unassigned is a waiting room, not an expulsion: the organization's own
 * document and its teams stay readable, because the directory is what the
 * person is there to see while they wait.
 */
describe('what an unassigned member may still read', () => {
  it('reads the organization it belongs to', async () => {
    await assertSucceeds(read(RESIDUAL, 'organizations', ORG_A))
  })

  it('reads that organization’s teams', async () => {
    await assertSucceeds(read(RESIDUAL, 'teams', TEAM_LIGHTING))
  })

  it('reads its own membership', async () => {
    await assertSucceeds(read(RESIDUAL, 'organization_memberships', `${ORG_A}_${RESIDUAL}`))
  })
})
