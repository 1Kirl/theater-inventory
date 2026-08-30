import { trackingModeOf } from '@/domain/inventory'
import { activeQuantityOf } from '@/domain/inventory-value'
import { costBreakdown, summarizeProductionCosts } from '@/domain/production-costs'
import { ACTION_TYPE_LABELS } from '@/domain/production'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem } from '@/types/production'

/**
 * What the charts are allowed to say.
 *
 * Every projection here is a rearrangement of numbers something else already
 * computed — `activeQuantityOf`, `summarizeProductionCosts`, the unit counts a
 * serialized item maintains. None of them decides what a figure means. A chart
 * that disagreed with the card above it would be worse than no chart, and the
 * only way to guarantee it cannot is to give it no arithmetic of its own.
 *
 * Colour travels as a CSS custom property rather than a resolved value, so a
 * wedge follows the theme the same way a badge does and dark mode needs no
 * second palette in JavaScript.
 */

export interface ChartDatum {
  key: string
  label: string
  value: number
  /** The custom property that paints it, e.g. `var(--tone-positive)`. */
  color: string
  /** Secondary text for the legend row, where the count alone is not the story. */
  hint?: string
}

function chartVar(index: number): string {
  // Six categorical colours, then it wraps. Nothing in this application
  // produces more than six chart categories.
  return `var(--chart-${String((index % 6) + 1)})`
}

/**
 * Which chart colour each lifecycle bucket takes.
 *
 * Deliberately the categorical palette rather than the status tones the badges
 * use. Those tones are chosen to be readable as *text* — dark on a light page,
 * light on a dark one — and several of them sit close together in hue because
 * they are never seen adjacent. Side by side as wedges of one ring they were
 * reported as indistinguishable on a phone, which is the reverse of what a
 * chart needs.
 *
 * A badge and a wedge for the same status therefore differ in shade. They are
 * never adjacent, they are labelled in both places, and legibility of the ring
 * is worth more than a colour match across two screens' distance.
 */
const LIFECYCLE_COLORS = {
  available: chartVar(0),        // green
  unusable_on_hand: chartVar(4), // orange
  in_use: chartVar(1),           // blue
  in_maintenance: chartVar(2),   // gold
  lost: chartVar(5),             // rose
  retired: chartVar(3),          // lavender
} as const

/* ------------------------------------------------------------------ *
 * Equipment lifecycle
 * ------------------------------------------------------------------ */

export interface LifecycleChart {
  slices: ChartDatum[]
  /** Everything the chart draws: active equipment plus retired history. */
  total: number
  /** Excludes retired, matching `active_total`. */
  activeTotal: number
  /** How many items contributed. Zero means there is nothing to draw. */
  serializedItemCount: number
}

/**
 * What state the individually tracked equipment is in.
 *
 * Six slices, not five. The obvious list — available, in use, in maintenance,
 * lost, retired — does not add up, because a unit sitting on the shelf in
 * unusable condition is active and present but is deliberately not counted as
 * available. `UnitCounts` names that term `unusable_on_hand`, and the invariant
 * it exists to satisfy is
 *
 *     active_total = available + unusable_on_hand + in_use + in_maintenance + lost
 *
 * Dropping it would either overstate `available` or leave a wedge of the ring
 * unaccounted for, and a reader would have no way to tell which.
 *
 * Only serialized items contribute. A bulk item is a quantity nobody counted
 * piece by piece; it has no lifecycle to chart, and folding its total in would
 * put units on the same ring as things that were never units.
 */
export function lifecycleChart(items: readonly InventoryItem[]): LifecycleChart {
  const totals = {
    available: 0,
    unusable_on_hand: 0,
    in_use: 0,
    in_maintenance: 0,
    lost: 0,
    retired: 0,
  }

  let serializedItemCount = 0

  for (const item of items) {
    const counts = item.unit_counts
    if (trackingModeOf(item) !== 'serialized' || !counts) continue

    serializedItemCount += 1
    totals.available += counts.available
    totals.unusable_on_hand += counts.unusable_on_hand
    totals.in_use += counts.in_use
    totals.in_maintenance += counts.in_maintenance
    totals.lost += counts.lost
    totals.retired += counts.retired
  }

  const slices: ChartDatum[] = [
    {
      key: 'available',
      label: UNIT_STATUS_LABELS.available,
      value: totals.available,
      color: LIFECYCLE_COLORS.available,
    },
    {
      key: 'unusable_on_hand',
      // Named for what it is rather than for its bucket: "on hand" is the part
      // that distinguishes it from a unit that has been retired or lost.
      label: 'Unusable, on hand',
      value: totals.unusable_on_hand,
      color: LIFECYCLE_COLORS.unusable_on_hand,
      hint: 'Present but not counted as available',
    },
    {
      key: 'in_use',
      label: UNIT_STATUS_LABELS.in_use,
      value: totals.in_use,
      color: LIFECYCLE_COLORS.in_use,
    },
    {
      key: 'in_maintenance',
      label: UNIT_STATUS_LABELS.in_maintenance,
      value: totals.in_maintenance,
      color: LIFECYCLE_COLORS.in_maintenance,
    },
    {
      key: 'lost',
      label: UNIT_STATUS_LABELS.lost,
      value: totals.lost,
      color: LIFECYCLE_COLORS.lost,
    },
    {
      key: 'retired',
      label: UNIT_STATUS_LABELS.retired,
      value: totals.retired,
      color: LIFECYCLE_COLORS.retired,
      hint: 'History; not part of active stock',
    },
  ]

  const activeTotal = totals.available + totals.unusable_on_hand + totals.in_use
    + totals.in_maintenance + totals.lost

  return {
    slices,
    total: activeTotal + totals.retired,
    activeTotal,
    serializedItemCount,
  }
}

/* ------------------------------------------------------------------ *
 * Inventory by category
 * ------------------------------------------------------------------ */

export interface CategoryChart {
  rows: ChartDatum[]
  /** The quantity all rows add up to. */
  total: number
  itemCount: number
}

/**
 * What the inventory is made of, counted in physical things.
 *
 * The metric is `activeQuantityOf` summed by category — the same function the
 * replacement-value estimate uses. It is the honest one to compare across
 * tracking modes: for a bulk item it is the quantity somebody maintains, and for
 * a serialized item it is `active_total`, which is that item's units minus the
 * retired ones. Both are "how many of this do we currently have", so a bar for
 * Cables and a bar for Lighting Instruments are measured in the same unit even
 * though one is a pile and the other is twenty-four numbered fixtures.
 *
 * Retired equipment is excluded from both sides, for the same reason the value
 * estimate excludes it: it is kept for its history and is not stock.
 *
 * The item count travels alongside as a hint rather than as the bar length,
 * because "forty cables" and "forty kinds of cable" are different claims and a
 * reader should not have to guess which one a bar means.
 */
export function categoryChart(items: readonly InventoryItem[]): CategoryChart {
  const quantities = new Map<string, { quantity: number; items: number }>()

  for (const item of items) {
    const category = item.category.trim() === '' ? 'Uncategorized' : item.category
    const entry = quantities.get(category) ?? { quantity: 0, items: 0 }
    entry.quantity += activeQuantityOf(item)
    entry.items += 1
    quantities.set(category, entry)
  }

  const rows = [...quantities.entries()]
    // Largest first: the question is what the inventory is mostly made of.
    // Ties fall back to the name so the order is stable between renders.
    .sort((left, right) =>
      right[1].quantity - left[1].quantity || left[0].localeCompare(right[0]))
    .map(([category, entry], index) => ({
      key: category,
      label: category,
      value: entry.quantity,
      color: chartVar(index),
      hint: `${String(entry.items)} item${entry.items === 1 ? '' : 's'}`,
    }))

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.value, 0),
    itemCount: items.length,
  }
}

/* ------------------------------------------------------------------ *
 * Production cost by kind of work
 * ------------------------------------------------------------------ */

export interface CostChart {
  rows: ChartDatum[]
  /** Cents. Known estimates only — see `unknownCount`. */
  knownTotalCents: number
  /** Counted actions carrying an estimate. */
  estimatedCount: number
  /**
   * Counted actions with no estimate at all.
   *
   * Never folded into the total and never drawn as a wedge. An unknown cost is
   * not a zero cost, and a chart that treats it as one is a budget somebody will
   * plan against and be wrong.
   */
  unknownCount: number
  /**
   * Whether any counted action carries an estimate at all.
   *
   * Asked of the count, never of the total. A build costed at exactly $0.00 is
   * something a person entered and the interface must not describe it as
   * missing — which is precisely what deriving this from `knownTotalCents > 0`
   * did, leaving a card whose headline read "$0.00" above a note saying no
   * estimate existed and inviting the reader to add the one they had just made.
   */
  hasKnownEstimate: boolean
  /**
   * Whether there is any length to draw.
   *
   * A separate question from the one above, and the only one the bars care
   * about. Four tracks scaled against a zero total would say the work was
   * costed and came to nothing in four separate categories, which is a claim
   * nobody made.
   */
  hasDrawableCost: boolean
}

/**
 * What a production's estimated spend is made of.
 *
 * Every number comes from `summarizeProductionCosts`, which already decides
 * which actions count — cancelled work is excluded, completed work is not — and
 * already keeps unknown estimates apart from zero ones. This adds colour and
 * order and nothing else.
 *
 * An action estimated at exactly $0.00 is real information and stays in the
 * known total; it simply contributes no length. Knowing a cost and having a
 * cost to draw are therefore two different questions, and this reports both
 * rather than collapsing them into one.
 */
export function costChart(actions: readonly ActionItem[]): CostChart {
  const summary = summarizeProductionCosts(actions)

  const rows = costBreakdown(summary).map((row, index) => ({
    key: row.type,
    label: ACTION_TYPE_LABELS[row.type],
    value: row.cents,
    color: chartVar(index),
  }))

  return {
    rows,
    knownTotalCents: summary.knownTotalCents,
    estimatedCount: summary.estimatedCount,
    unknownCount: summary.missingCount,
    hasKnownEstimate: summary.estimatedCount > 0,
    hasDrawableCost: summary.knownTotalCents > 0,
  }
}
