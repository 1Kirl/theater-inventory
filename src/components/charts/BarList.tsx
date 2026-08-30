import { cn } from '@/lib/utils'
import type { ChartDatum } from '@/domain/chart-projections'

interface Props {
  data: readonly ChartDatum[]
  /** How a value is written out. Cents and counts are not formatted alike. */
  format: (value: number) => string
  /** Rows at zero are dropped unless zero is itself worth reporting. */
  keepZero?: boolean
  className?: string
}

/**
 * Horizontal bars, as a description list.
 *
 * A bar chart of labelled magnitudes is a table with one visual column, so it is
 * marked up as one: the label and the value are real text that a screen reader
 * reads in order, and the coloured track is decoration layered behind them. That
 * ordering is deliberate — the numbers are the content, and the bars are the
 * part you can skip.
 *
 * The longest row sets the scale rather than the total, because the question
 * these answer is "which is biggest and by how much", not "what fraction of the
 * whole is this".
 */
export function BarList({ data, format, keepZero = false, className }: Props) {
  const rows = keepZero ? [...data] : data.filter((datum) => datum.value > 0)
  const largest = rows.reduce((max, datum) => Math.max(max, datum.value), 0)

  if (rows.length === 0) return null

  return (
    <dl className={cn('space-y-2.5', className)}>
      {rows.map((datum) => (
        <div key={datum.key} className="space-y-1">
          {/* The label wraps instead of truncating, for the reason given in
              ChartLegend: shortening a category name to fit a phone would be a
              vocabulary change disguised as a layout decision. */}
          <div className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 break-words text-sm">
              {datum.label}
              {datum.hint ? (
                <span className="text-muted-foreground ml-1.5 text-xs">{datum.hint}</span>
              ) : null}
            </dt>
            <dd className="shrink-0 text-sm font-medium tabular-nums">{format(datum.value)}</dd>
          </div>
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: largest > 0 ? `${String((datum.value / largest) * 100)}%` : '0%',
                backgroundColor: datum.color,
              }}
            />
          </div>
        </div>
      ))}
    </dl>
  )
}
