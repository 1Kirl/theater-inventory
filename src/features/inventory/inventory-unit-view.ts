import { isSerialized } from '@/domain/inventory'
import type { InventoryItem, UnitStatus } from '@/types/inventory'

/** Presentation helpers for individual units. Pure, so every view agrees. */

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  available: 'Available',
  in_use: 'In use',
  in_maintenance: 'In maintenance',
  lost: 'Lost',
  retired: 'Retired',
}

/**
 * Where a unit's status colour comes from.
 *
 * Re-exported rather than defined here: the tone vocabulary is shared with
 * maintenance, productions, actions, and conditions, and a second copy for
 * inventory is exactly how "lost" and "retired" ended up the same grey.
 */
export { unitStatusTone } from '@/domain/status-tone'

/**
 * Which parent fields describe the equipment, and which do not.
 *
 * A bulk item is one line about a pile of identical things, so its location,
 * owning team, inspection date, and last-updated stamp describe all of it. A
 * serialized item is a grouping of individually managed assets, each with its
 * own — so presenting a single value would be a claim about equipment it does
 * not speak for.
 *
 * Extracted so the list, the detail, and their tests agree rather than each
 * deciding separately.
 */
export interface ItemPresentation {
  /** True when the item is a grouping rather than one physical thing. */
  isGrouping: boolean
  showsParentLocation: boolean
  showsParentTeam: boolean
  showsParentInspection: boolean
  /**
   * `updated_at` on a grouping moves whenever any unit does, so as equipment
   * information it says nothing — a clamp inspected last spring reads as
   * touched this morning because someone else's clamp came back from repair.
   */
  showsParentUpdatedAt: boolean
  /** Aggregate lifecycle counts belong on a grouping and nowhere else. */
  showsLifecycleSummary: boolean
  badge: string | null
}

export function itemPresentation(
  item: Pick<InventoryItem, 'tracking_mode'>,
): ItemPresentation {
  const grouping = isSerialized(item)

  return {
    isGrouping: grouping,
    showsParentLocation: !grouping,
    showsParentTeam: !grouping,
    showsParentInspection: !grouping,
    showsParentUpdatedAt: !grouping,
    showsLifecycleSummary: grouping,
    badge: grouping ? 'Individual Equipment' : null,
  }
}

/** The lifecycle line for a serialized item, skipping the empty buckets. */
export function unitBreakdownLine(item: Pick<InventoryItem, 'unit_counts'>): string {
  const counts = item.unit_counts
  if (!counts) return 'No units yet'

  const parts = [
    `${String(counts.available)} available`,
    counts.in_use > 0 ? `${String(counts.in_use)} in use` : null,
    counts.in_maintenance > 0 ? `${String(counts.in_maintenance)} in maintenance` : null,
    counts.lost > 0 ? `${String(counts.lost)} lost` : null,
    counts.unusable_on_hand > 0 ? `${String(counts.unusable_on_hand)} unusable` : null,
  ].filter((part): part is string => part !== null)

  return parts.join(' \u00b7 ')
}

/**
 * How many units are listed at once before the list is split.
 *
 * Fifteen. Sixteen units is where scrolling the card stopped being pleasant,
 * which is the whole reason this exists; below that the control would cost a
 * row of chrome and save nothing.
 */
export const UNITS_PAGE_SIZE = 15

export interface UnitPage<T> {
  /** The slice to render. */
  items: T[]
  /** 1-based, and always a page that exists. */
  page: number
  pageCount: number
  /** False when everything fits at once, which is when the control is hidden. */
  paginated: boolean
  /** 1-based positions of the slice within the whole list, for "16–30 of 42". */
  from: number
  to: number
  total: number
}

/**
 * One page of a list, with the page number corrected rather than trusted.
 *
 * The correction is the point. A page number lives in component state while the
 * list it indexes is reloaded underneath it — deleting the last unit on the last
 * page, or generating a run that changes the count — and a stale number would
 * render an empty card with no way back. Clamping into range means the view is
 * always showing something real, so no effect has to watch the length and reset
 * anything.
 *
 * The order is the caller's. This slices what it is given and sorts nothing, so
 * whatever filter or ordering the list already applies is what gets paginated.
 */
export function paginateUnits<T>(
  units: readonly T[],
  requestedPage: number,
  pageSize: number = UNITS_PAGE_SIZE,
): UnitPage<T> {
  const total = units.length
  const size = Math.max(1, Math.floor(pageSize))
  // An empty list is one empty page, not zero pages: the card still renders.
  const pageCount = Math.max(1, Math.ceil(total / size))

  const requested = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1
  const page = Math.min(Math.max(requested, 1), pageCount)

  const startIndex = (page - 1) * size
  const items = units.slice(startIndex, startIndex + size)

  return {
    items,
    page,
    pageCount,
    paginated: total > size,
    // Zero rather than one when there is nothing, so "0–0 of 0" cannot claim a
    // first item that is not there.
    from: total === 0 ? 0 : startIndex + 1,
    to: startIndex + items.length,
    total,
  }
}
