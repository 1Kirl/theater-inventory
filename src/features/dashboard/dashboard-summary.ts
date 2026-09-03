import { conditionSummary } from '@/domain/inventory'
import { currentlyInService, isOverdue, openRecords } from '@/domain/maintenance'
import { isSerializedMaintenance } from '@/domain/unit-maintenance'
import { isOpenAction, requirementAvailability } from '@/domain/production'
import { dateKeyOf, sortEvents, toDateKey } from '@/domain/calendar'
import { hasModuleAccess } from '@/domain/module-access'
import type { EffectiveRole } from '@/domain/effective-role'
import type { InventoryItem } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { ActionItem, ActionType, Production, ProductionRequirement } from '@/types/production'
import type { CalendarEvent } from '@/types/calendar'
import type { ModulePermissions } from '@/types/organization'

/**
 * Dashboard arithmetic, kept pure and kept honest.
 *
 * Nothing here is stored. Every figure is recomputed from the records the
 * caller was permitted to read, using the same functions the module pages use —
 * `conditionSummary`, `currentlyInService`, `isOverdue`, `requirementAvailability`,
 * `isOpenAction`, `dateKeyOf`. A second implementation of any of those would be
 * a second answer, and the dashboard is where a disagreement would be least
 * likely to be noticed.
 */

export interface DashboardAccess {
  inventory: boolean
  maintenance: boolean
  productions: boolean
  calendar: boolean
}

/**
 * Which sections exist for this user.
 *
 * The dashboard has no permission of its own; each card follows the module it
 * summarizes. This is also what decides which queries run at all — a module the
 * user cannot view is never fetched, rather than fetched and hidden.
 */
export function dashboardAccess(
  role: EffectiveRole | null,
  permissions: ModulePermissions | null,
): DashboardAccess {
  return {
    inventory: hasModuleAccess(role, permissions, 'inventory', 'view'),
    maintenance: hasModuleAccess(role, permissions, 'maintenance', 'view'),
    productions: hasModuleAccess(role, permissions, 'productions', 'view'),
    calendar: hasModuleAccess(role, permissions, 'calendar', 'view'),
  }
}

export function hasAnyAccess(access: DashboardAccess): boolean {
  return access.inventory || access.maintenance || access.productions || access.calendar
}

export interface InventorySummary {
  itemCount: number
  totalUnits: number
  availableUnits: number
  /** Items whose overall condition is needs-repair or unusable. */
  needsAttentionCount: number
  /**
   * Individually tracked units currently missing.
   *
   * Read from each serialized item's stored counts rather than by querying
   * units — the dashboard already loads the items, and counting this way costs
   * nothing extra. Bulk items contribute zero because a quantity cannot be
   * missing; only a named piece of equipment can.
   */
  lostUnits: number
}

export function summarizeInventory(items: readonly InventoryItem[]): InventorySummary {
  let totalUnits = 0
  let availableUnits = 0
  let needsAttentionCount = 0
  let lostUnits = 0

  for (const item of items) {
    totalUnits += item.quantity_total
    availableUnits += item.quantity_available
    lostUnits += item.unit_counts?.lost ?? 0

    const summary = conditionSummary(item.condition_counts)
    if (summary === 'needs_repair' || summary === 'unusable') needsAttentionCount += 1
  }

  return { itemCount: items.length, totalUnits, availableUnits, needsAttentionCount, lostUnits }
}

export interface MaintenanceSummary {
  /** Repair jobs still open, counted as records. */
  openCount: number
  /**
   * Equipment currently away for repair.
   *
   * Two sources, deliberately. A bulk repair is a quantity nobody counted piece
   * by piece, so its own record is the only thing that knows. A serialized item
   * counts its units, and those counts are what the equipment itself says — so
   * they win over a repair record that might disagree.
   *
   * Serialized repair records are excluded from the record-based half, or the
   * same equipment would be counted twice.
   */
  inServiceQuantity: number
  overdueCount: number
  recent: MaintenanceRecord[]
}

function newestFirst(left: MaintenanceRecord, right: MaintenanceRecord): number {
  const leftAt = left.created_at?.toMillis?.() ?? 0
  const rightAt = right.created_at?.toMillis?.() ?? 0
  return rightAt - leftAt
}

export function summarizeMaintenance(
  records: readonly MaintenanceRecord[],
  now: Date,
  limit = 5,
  /** Serialized items, whose own counts are authoritative for their equipment. */
  items: readonly InventoryItem[] = [],
): MaintenanceSummary {
  const open = openRecords(records)

  // A bulk repair is the only record of its own quantity. A serialized one is
  // not: its equipment counts itself, so the record is skipped here and the
  // items are counted instead. Counting both would count the same clamp twice.
  const bulkRecords = records.filter((record) => !isSerializedMaintenance(record))
  const serializedInMaintenance = items.reduce(
    (total, item) => total + (item.unit_counts?.in_maintenance ?? 0),
    0,
  )

  return {
    openCount: open.length,
    // The existing rule: sent, in service, or ready. Not the same set as an
    // open job, because a planned repair has not left the building yet.
    inServiceQuantity: currentlyInService(bulkRecords) + serializedInMaintenance,
    overdueCount: records.filter((record) => isOverdue(record, now)).length,
    recent: [...records].sort(newestFirst).slice(0, limit),
  }
}

export interface ActiveProductionRow {
  production: Production
  requirementCount: number
  /** Null when inventory could not be read, so no shortage could be computed. */
  shortageCount: number | null
  openActionCount: number
}

export interface ProductionsSummary {
  activeCount: number
  openActionCount: number
  /** Null when inventory could not be read. Never zero standing in for unknown. */
  shortageCount: number | null
  active: ActiveProductionRow[]
}

/**
 * Shortage needs the inventory a requirement is matched against, so a user with
 * productions access but not inventory access has no shortage to be told.
 *
 * That case reports null rather than zero. Zero would read as "nothing is
 * short", which is a different and possibly false statement.
 */
export function summarizeProductions(params: {
  productions: readonly Production[]
  requirements: readonly ProductionRequirement[]
  actions: readonly ActionItem[]
  items: readonly InventoryItem[]
  canReadInventory: boolean
  limit?: number
}): ProductionsSummary {
  const active = params.productions.filter((production) => production.status === 'active')
  const openActions = params.actions.filter((action) => isOpenAction(action.status))

  function shortageIn(requirements: readonly ProductionRequirement[]): number | null {
    if (!params.canReadInventory) return null

    return requirements.filter((requirement) => {
      const availability = requirementAvailability(requirement, params.items)
      return availability.matched && availability.shortage > 0
    }).length
  }

  const rows = active.map((production) => {
    const requirements = params.requirements.filter(
      (requirement) => requirement.production_id === production.production_id,
    )

    return {
      production,
      requirementCount: requirements.length,
      shortageCount: shortageIn(requirements),
      openActionCount: openActions.filter(
        (action) => action.production_id === production.production_id,
      ).length,
    }
  })

  return {
    activeCount: active.length,
    openActionCount: openActions.length,
    shortageCount: shortageIn(
      params.requirements.filter((requirement) =>
        active.some((production) => production.production_id === requirement.production_id)),
    ),
    active: rows.slice(0, params.limit ?? 3),
  }
}

export interface ActionsSummary {
  /** Actions still to do or in progress. What the card reports. */
  openCount: number
  /** The same open actions, split by the work they call for. */
  openByType: Record<ActionType, number>
  /** Every action ever raised, open or not, so an empty card can say which it is. */
  totalCount: number
}

/**
 * Needs & Actions, counted the way its own page counts it.
 *
 * The dashboard already loads action items — the productions module reads them
 * alongside productions and requirements — so this is arithmetic over records
 * the page has in hand, not a new query and not a stored aggregate.
 *
 * Open is `isOpenAction`, the same predicate the list page and the production
 * summary use. Done and cancelled work is excluded from the breakdown but still
 * counted in `totalCount`, which is what lets the card tell "nothing has been
 * planned yet" apart from "everything is finished".
 */
export function summarizeActionItems(actions: readonly ActionItem[]): ActionsSummary {
  const openByType: Record<ActionType, number> = { buy: 0, rent: 0, build: 0, repair: 0 }
  let openCount = 0

  for (const action of actions) {
    if (!isOpenAction(action.status)) continue
    openCount += 1
    openByType[action.action_type] += 1
  }

  return { openCount, openByType, totalCount: actions.length }
}

/**
 * Every event from today onward, soonest first.
 *
 * Deliberately uncapped. This used to take a limit and return the first few,
 * which meant the only thing the dashboard could count was the truncated list —
 * six upcoming events reported as five. Counting and previewing are different
 * questions, and every other summary here already keeps them apart.
 *
 * Compared as local date keys rather than timestamps, which is what keeps an
 * early-morning event from falling into yesterday. `sortEvents` then applies the
 * calendar's own order: by date, then all-day first, then start time, then
 * title. The date half of that used to be missing, which is what made this list
 * order by time of day across different days.
 */
export function upcomingEvents(
  events: readonly CalendarEvent[],
  from: Date,
): CalendarEvent[] {
  const fromKey = toDateKey(from)

  return sortEvents(events.filter((event) => dateKeyOf(event) >= fromKey))
}

export interface CalendarSummary {
  /** Everything upcoming. What the summary card reports. */
  upcomingCount: number
  /** The soonest few, for the list beneath it. */
  preview: CalendarEvent[]
}

export function summarizeCalendar(
  events: readonly CalendarEvent[],
  from: Date,
  previewLimit = 5,
): CalendarSummary {
  const upcoming = upcomingEvents(events, from)

  return { upcomingCount: upcoming.length, preview: upcoming.slice(0, previewLimit) }
}
