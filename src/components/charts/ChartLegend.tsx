import { cn } from '@/lib/utils'
import type { ChartDatum } from '@/domain/chart-projections'

interface Props {
  data: readonly ChartDatum[]
  format?: (value: number) => string
  className?: string
}

/**
 * The figures a ring cannot state.
 *
 * Not an ornament beside the chart — this is where the information actually
 * lives. Every category appears with its number whether or not it has a wedge,
 * so a zero is visibly zero rather than silently missing, and somebody who
 * cannot distinguish the colours loses nothing.
 *
 * Each row is a three-column grid — marker, label, value — rather than a flex
 * row, so the label column is the only one that flexes and the value stays
 * aligned on the right at every width. The list itself is a grid too, one
 * column by default; a caller that has room may ask for more. The label wraps rather than truncating:
 * an abbreviated lifecycle term would be a change to the product's vocabulary
 * made by a layout constraint, and "Unusable, on hand" means something narrower
 * than "Unusable". The hint sits on its own line beneath the label for the same
 * reason — as part of the label's line it was long enough to push the row past
 * the card and get cut off, which is what a phone showed.
 */
export function ChartLegend({ data, format = String, className }: Props) {
  return (
    <ul className={cn('grid w-full min-w-0 gap-y-2', className)}>
      {data.map((datum) => (
        <li
          key={datum.key}
          className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 text-sm"
        >
          <span
            className="size-2 shrink-0 translate-y-1 rounded-full"
            style={{ backgroundColor: datum.color }}
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            {datum.label}
            {datum.hint ? (
              <span className="text-muted-foreground block text-xs">{datum.hint}</span>
            ) : null}
          </span>
          <span className="shrink-0 font-medium tabular-nums">{format(datum.value)}</span>
        </li>
      ))}
    </ul>
  )
}
