import { cn } from '@/lib/utils'
import { arcPath, donutArcs } from '@/domain/donut-geometry'
import type { ChartDatum } from '@/domain/chart-projections'

interface Props {
  data: readonly ChartDatum[]
  /** Drawn in the middle. The number the ring adds up to. */
  centerValue: string
  centerLabel: string
  /** Read out to assistive technology in place of the drawing. */
  summary: string
  /**
   * Outer diameter in pixels. The stroke scales with it, so the ring keeps its
   * proportions instead of getting a hairline band at a larger size.
   */
  size?: number
  className?: string
}

const DEFAULT_SIZE = 132
/** Band thickness as a fraction of the diameter, from the original 18/132. */
const STROKE_RATIO = 18 / 132

/**
 * A ring, drawn as one independent arc per segment.
 *
 * See `@/domain/donut-geometry` for why the arcs are separate paths rather than
 * dashed circles stacked on top of each other, and why there is no gap between
 * them. The angle arithmetic lives there and is tested; this file only turns it
 * into elements.
 *
 * Colours arrive as CSS custom properties rather than resolved values, so a
 * wedge follows the theme the way a badge does — which is also why there is no
 * charting library here: one would have wanted colour strings and a second
 * palette in JavaScript for dark mode.
 *
 * The drawing is replaced by `summary` for assistive technology, and the legend
 * that accompanies it carries the same figures as real text, so nothing is
 * communicated by colour alone.
 */
export function DonutChart({
  data, centerValue, centerLabel, summary, size = DEFAULT_SIZE, className,
}: Props) {
  const arcs = donutArcs(data)
  const colors = new Map(data.map((datum) => [datum.key, datum.color]))

  const stroke = Math.round(size * STROKE_RATIO)
  const radius = (size - stroke) / 2
  const center = size / 2

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        role="img"
        aria-label={summary}
      >
        {/* The track, so an empty or part-filled ring still reads as a ring. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <path
            key={arc.key}
            d={arcPath(center, center, radius, arc.startAngle, arc.endAngle)}
            fill="none"
            stroke={colors.get(arc.key) ?? 'var(--muted)'}
            strokeWidth={stroke}
            // Square ends that stop exactly on the boundary. Rounded caps would
            // extend past it and lap the neighbouring wedge.
            strokeLinecap="butt"
            shapeRendering="geometricPrecision"
          />
        ))}
      </svg>

      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
        aria-hidden="true"
      >
        <span
          className={cn('font-semibold tabular-nums', size >= 160 ? 'text-3xl' : 'text-xl')}
        >
          {centerValue}
        </span>
        <span className="text-muted-foreground text-xs">{centerLabel}</span>
      </div>
    </div>
  )
}
