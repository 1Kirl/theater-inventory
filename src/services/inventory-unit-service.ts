import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
  type DocumentReference,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildInventoryUnitDocument, buildInventoryUnitUpdate, type InventoryUnitInput,
} from '@/domain/inventory-unit-payloads'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { isSerialized } from '@/domain/inventory'
import {
  EMPTY_MIRRORS, MAX_BULK_UNITS, mirrorsOf, promotionMaintenanceBlock, validatePromotion,
  withConditionChanged, withUnitsAdded,
  type ItemMirrors, type PromotionDraft,
} from '@/domain/inventory-unit'
import { listMaintenanceRecordsForItem } from '@/services/maintenance-service'
import type { InventoryItem, InventoryUnit, UnitStatus } from '@/types/inventory'

/**
 * Individual physical units, and the parent summary they keep in step.
 *
 * Every write that changes what a unit is goes through a transaction that reads
 * the parent, computes its next mirrors, and writes both. That is what keeps
 * the summary from drifting: the change either lands completely or not at all,
 * and a concurrent writer is serialized rather than lost.
 *
 * A whole batch goes in one transaction rather than one per unit. The access
 * call budget looked like the reason not to — twenty per batch, and every unit
 * create makes Rules read the parent — but `tests/rules/inventory-unit-transactions.test.ts`
 * measures it against the published Rules and the ceiling is not there: Rules
 * charge per distinct document read, so four hundred units sharing one parent
 * cost a single call and commit fine, while twenty-five units under twenty-five
 * different parents fail. Units of one item share a parent by definition, so the
 * batch is atomic and `MAX_BULK_UNITS` sits well inside both that and the
 * five-hundred-write transaction limit.
 */

const MAX_ASSET_CODE_LENGTH = 60
const MAX_LOCATION_LENGTH = 120
const MAX_NOTES_LENGTH = 2000

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
}

function validateInput(input: InventoryUnitInput): void {
  const code = input.assetCode.trim()
  if (code.length === 0 || code.length > MAX_ASSET_CODE_LENGTH) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      `Asset code must be between 1 and ${MAX_ASSET_CODE_LENGTH} characters.`,
    )
  }

  const location = input.storageLocation.trim()
  if (location.length === 0 || location.length > MAX_LOCATION_LENGTH) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      `Storage location must be between 1 and ${MAX_LOCATION_LENGTH} characters.`,
    )
  }

  if ((input.notes?.trim().length ?? 0) > MAX_NOTES_LENGTH) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
    )
  }

  // A unit that is out has to say who has it. The payload builder drops a
  // borrowing team it was not given, which would otherwise turn this into a
  // permission-denied from Rules rather than something the caller can act on.
  if (input.status === 'in_use' && (input.usingTeamId ?? '').trim().length === 0) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      'A unit that is in use has to say which team has it.',
    )
  }

  // The reverse: borrowing details on a unit that is not out would be stored as
  // a contradiction, and Rules reject the document outright.
  if (input.status !== 'in_use'
      && ((input.usingTeamId ?? '').length > 0
        || (input.usingMemberUid ?? '').length > 0
        || input.checkedOutAt)) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      'Only a unit that is in use can name a borrowing team or member.',
    )
  }
}

/**
 * The units of one item.
 *
 * Two equality filters, which single-field indexes already serve — the same
 * shape the requirement query uses, and the reason this collection needs no
 * composite index. Sorting is done here for that reason too.
 */
export async function listUnitsForItem(params: {
  organizationId: string
  itemId: string
}): Promise<InventoryUnit[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.inventoryUnits),
      where('organization_id', '==', params.organizationId),
      where('inventory_item_id', '==', params.itemId),
    ),
  )

  return snapshot.docs
    .map((entry) => entry.data() as InventoryUnit)
    .sort((left, right) => left.asset_code.localeCompare(right.asset_code, undefined, {
      numeric: true,
    }))
}

export async function getInventoryUnit(unitId: string): Promise<InventoryUnit | null> {
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.inventoryUnits, unitId))
  return snapshot.exists() ? (snapshot.data() as InventoryUnit) : null
}

/** Asset codes already used in this organization, for the duplicate warning. */
export async function listAssetCodes(organizationId: string): Promise<string[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.inventoryUnits),
      where('organization_id', '==', organizationId),
    ),
  )

  return snapshot.docs.map((entry) => (entry.data() as InventoryUnit).asset_code)
}

/** The parent fields a serialized item mirrors, as an item update input. */
function itemInputWithMirrors(item: InventoryItem, mirrors: ItemMirrors) {
  return {
    name: item.name,
    category: item.category,
    teamId: item.team_id,
    trackingMode: 'serialized' as const,
    unitCounts: mirrors.unit_counts,
    quantityTotal: mirrors.quantity_total,
    quantityAvailable: mirrors.quantity_available,
    conditionCounts: mirrors.condition_counts,
    location: item.location,
    lastInspectedAt: item.last_inspected_at ?? null,
    notes: item.notes,
  }
}

/**
 * A unit's owning team has to exist.
 *
 * Rules check this too — `teamBelongsToOrganization`, the same test an item's
 * team gets. Checking here as well turns a permission-denied into something the
 * caller can explain, and catches it before a transaction opens.
 */
function requireRealTeam(teamId: string, teamIds: readonly string[]): void {
  if (!teamIds.includes(teamId)) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      'Choose an owning team from this organization.',
    )
  }
}

/**
 * What a newly registered piece of equipment may already be.
 *
 * Registering an asset is not the same as acquiring one: a clamp being added to
 * the system may already be out with a crew, or already missing, and the person
 * entering it can say so truthfully.
 *
 * Maintenance and retirement are not among the options, for the same reason as
 * everywhere else — a unit in maintenance needs the repair record that explains
 * it, and a retired one needs the history it is retiring from. Neither can be
 * conjured at creation.
 */
const CREATABLE_STATUSES: readonly UnitStatus[] = ['available', 'in_use', 'lost']

function requireCreatableStatus(input: InventoryUnitInput): void {
  if (!CREATABLE_STATUSES.includes(input.status)) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      'A new unit can start as available, in use, or lost. Maintenance and retirement come '
      + 'from what happens to it.',
    )
  }
}

/**
 * Create units and move their parent's summary in the same transaction.
 *
 * The parent is read inside the transaction rather than trusted from the page,
 * so two people adding units at the same time cannot both compute their
 * counters from the same stale total.
 */
export async function createInventoryUnits(params: {
  item: InventoryItem
  units: readonly InventoryUnitInput[]
  /** The organization's real teams, so an owning team can be checked. */
  teamIds: readonly string[]
}): Promise<{ unitIds: string[] }> {
  const uid = requireUid()

  if (params.units.length === 0) {
    throw new OrganizationError('invalid-inventory-unit', 'There is nothing to create.')
  }
  if (params.units.length > MAX_BULK_UNITS) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      `Create at most ${MAX_BULK_UNITS} units at a time.`,
    )
  }
  for (const input of params.units) {
    validateInput(input)
    requireCreatableStatus(input)
    requireRealTeam(input.owningTeamId, params.teamIds)
  }

  if (!isSerialized(params.item)) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      'This item tracks a quantity rather than individual equipment.',
    )
  }

  const db = getFirebaseDb()
  const itemRef = doc(db, COLLECTIONS.inventoryItems, params.item.item_id)
  // Allocated once, outside the transaction: see the note in the promotion
  // below. Reusing these refs is what makes a contended retry idempotent.
  const unitRefs = params.units.map(() => doc(collection(db, COLLECTIONS.inventoryUnits)))

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef)
    if (!snapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }

    const item = snapshot.data() as InventoryItem
    if (!isSerialized(item)) {
      throw new OrganizationError(
        'invalid-inventory-unit',
        'This item tracks a quantity rather than individual equipment.',
      )
    }

    const next = withUnitsAdded(mirrorsOf(item), params.units)

    params.units.forEach((input, index) => {
      const unitRef = unitRefs[index] as DocumentReference
      transaction.set(unitRef, buildInventoryUnitDocument({
        unitId: unitRef.id,
        organizationId: item.organization_id,
        inventoryItemId: item.item_id,
        uid,
        now: serverTimestamp,
        input,
      }))
    })

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, next),
    }))
  })

  return { unitIds: unitRefs.map((ref) => ref.id) }
}

/** One unit, which is the batch above with a single member. */
export async function createInventoryUnit(params: {
  item: InventoryItem
  input: InventoryUnitInput
  teamIds: readonly string[]
}): Promise<{ unitId: string }> {
  const { unitIds } = await createInventoryUnits({
    item: params.item,
    units: [params.input],
    teamIds: params.teamIds,
  })
  return { unitId: unitIds[0] as string }
}

/**
 * Edit a unit's metadata, moving the parent's summary if the condition changed.
 *
 * Lifecycle status is not editable here. Checking equipment out, sending it for
 * repair, and retiring it are operations with their own rules and their own
 * history, and a free-text status field would let someone skip all of it.
 */
export async function updateInventoryUnit(params: {
  existing: InventoryUnit
  input: Omit<InventoryUnitInput, 'status'>
  teamIds: readonly string[]
}): Promise<void> {
  requireUid()
  requireRealTeam(params.input.owningTeamId, params.teamIds)

  const input: InventoryUnitInput = {
    ...params.input,
    // Carried through unchanged; this phase has no lifecycle operations.
    status: params.existing.status,
    retirementReason: params.existing.retirement_reason ?? null,
    usingTeamId: params.existing.using_team_id ?? null,
    usingMemberUid: params.existing.using_member_uid ?? null,
    checkedOutAt: params.existing.checked_out_at ?? null,
    // Carried through: Rules refuse an edit that changes any of these without
    // the operation that owns them. An edit is not a lifecycle move and not a
    // maintenance operation, so it must leave all of them exactly as they are —
    // and a full-document write that omits one deletes it.
    lastLifecycleEventId: params.existing.last_lifecycle_event_id,
    currentMaintenanceRecordId: params.existing.current_maintenance_record_id ?? null,
    maintenanceRecordIds: params.existing.maintenance_record_ids,
    plannedMaintenanceRecordId: params.existing.planned_maintenance_record_id ?? null,
  }
  validateInput(input)

  const db = getFirebaseDb()
  const unitRef = doc(db, COLLECTIONS.inventoryUnits, params.existing.unit_id)
  const itemRef = doc(db, COLLECTIONS.inventoryItems, params.existing.inventory_item_id)

  const conditionChanged = params.existing.condition !== input.condition

  await runTransaction(db, async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef)
    if (!itemSnapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }
    const item = itemSnapshot.data() as InventoryItem

    transaction.set(unitRef, buildInventoryUnitUpdate({
      unitId: params.existing.unit_id,
      organizationId: params.existing.organization_id,
      inventoryItemId: params.existing.inventory_item_id,
      createdByUid: params.existing.created_by_uid,
      createdAt: params.existing.created_at,
      now: serverTimestamp,
      input,
    }))

    if (!conditionChanged) return

    const next = withConditionChanged(mirrorsOf(item), {
      status: params.existing.status,
      from: params.existing.condition,
      to: input.condition,
    })

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, next),
    }))
  })
}

/**
 * Turn a bulk item into a serialized one, atomically.
 *
 * Every unit and the parent's new mode land in one transaction, so there is no
 * window in which the item claims to be serialized while some of its units are
 * missing. Either the conversion happened or it did not, and a failure leaves a
 * working bulk item with its original numbers.
 */
export async function promoteToSerialized(params: {
  item: InventoryItem
  drafts: readonly PromotionDraft[]
  /** The organization's real teams, so a borrowing team can be checked. */
  teamIds: readonly string[]
}): Promise<void> {
  const uid = requireUid()

  if (isSerialized(params.item)) {
    throw new OrganizationError(
      'invalid-inventory-unit',
      'This item already tracks individual equipment.',
    )
  }

  // Everything the user still had to decide is settled here, before a single
  // write is prepared: every unit classified, and every unit that is out naming
  // a team that exists.
  // Open repairs have to be closed first, and this is checked here rather than
  // only in the wizard: a form is not a data-integrity boundary.
  //
  // Reading the repairs needs the maintenance permission. Someone who may edit
  // inventory but not read maintenance cannot establish that there are none, and
  // the honest answer to "I cannot tell" is to refuse rather than to convert and
  // hope. Failing closed costs that user a conversion; failing open would strand
  // a repair with no units to attach it to.
  let records: Awaited<ReturnType<typeof listMaintenanceRecordsForItem>>
  try {
    records = await listMaintenanceRecordsForItem({
      organizationId: params.item.organization_id,
      itemId: params.item.item_id,
    })
  } catch {
    throw new OrganizationError(
      'promotion-blocked-by-maintenance',
      'This item\'s repair history could not be read, so it is not possible to confirm that '
      + 'no repairs are open. Ask someone with maintenance access to convert it.',
    )
  }

  const blocked = promotionMaintenanceBlock(records)
  if (blocked) {
    throw new OrganizationError(
      'promotion-blocked-by-maintenance',
      `This item has ${String(blocked.openRecordCount)} active maintenance `
      + `record${blocked.openRecordCount === 1 ? '' : 's'}. Individual tracking cannot be `
      + 'enabled until those repairs are completed or cancelled.',
    )
  }

  const check = validatePromotion({
    item: params.item,
    drafts: params.drafts,
    teamIds: params.teamIds,
  })
  if (!check.valid) {
    throw new OrganizationError('invalid-inventory-unit', check.message)
  }
  const drafts = check.drafts

  const db = getFirebaseDb()
  const itemRef = doc(db, COLLECTIONS.inventoryItems, params.item.item_id)
  // Allocated once, outside the transaction. A transaction body may run more
  // than once when it contends, and refs generated inside it would differ on
  // each attempt — the retry would write a second set of units rather than
  // replacing the first.
  const unitRefs = drafts.map(() => doc(collection(db, COLLECTIONS.inventoryUnits)))

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef)
    if (!snapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }

    const item = snapshot.data() as InventoryItem
    if (isSerialized(item)) {
      // Someone else converted it while this wizard was open.
      throw new OrganizationError(
        'invalid-inventory-unit',
        'This item already tracks individual equipment.',
      )
    }

    drafts.forEach((draft, index) => {
      const unitRef = unitRefs[index] as DocumentReference
      transaction.set(unitRef, buildInventoryUnitDocument({
        unitId: unitRef.id,
        organizationId: item.organization_id,
        inventoryItemId: item.item_id,
        uid,
        now: serverTimestamp,
        input: {
          assetCode: draft.assetCode,
          owningTeamId: draft.owningTeamId,
          condition: draft.condition,
          status: draft.status,
          storageLocation: draft.storageLocation,
          // The reviewer's answer, never the item's owning team: which crew has
          // a unit is not something the conversion is entitled to guess.
          usingTeamId: draft.status === 'in_use' ? (draft.usingTeamId ?? null) : null,
        },
      }))
    })

    // Computed from the drafts alone, and absolutely rather than by increment:
    // the old aggregate numbers are exactly what the conversion replaces, so a
    // retry recomputes the same totals instead of adding to them.
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, drafts)

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, mirrors),
    }))
  })
}
