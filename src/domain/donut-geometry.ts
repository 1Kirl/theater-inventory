/**
 * Where each wedge of a ring starts and ends.
 *
 * The first implementation stacked one full circle per segment and cut each
 * down with `stroke-dasharray` and a negative `stroke-dashoffset`. The
 * arithmetic was right, but the drawing was six full-circumference strokes
 * painted on top of one another in DOM order — so the last segment's end was
 * laid over the first segment's start at twelve o'clock, and an eighteen-pixel
 * anti-aliased stroke on a curve made that overlap read as a squashed boundary.
 * Six divisions of the circumference also do not necessarily add back up to it,
 * so the final dash could overshoot the seam by a rounding error and wrap onto
 * the segment underneath.
 *
 * Independent arcs remove the mechanism rather than tuning it. Each wedge is
 * its own path with an exact start and end angle, nothing overlaps anything,
 * and there is no wrap-around point to distort — the last arc simply ends where
 * the first one begins.
 *
 * No gap is inserted between wedges. A gap is the usual way to make boundaries
 * obvious, and it was rejected here: a fixed angular gap costs a small wedge a
 * far larger share of itself than a big one, which would misstate the very
 * proportions the chart exists to show. Telling the wedges apart is the
 * palette's job.
 *
 * Angles are degrees clockwise from twelve o'clock.
 */

export interface DonutArc {
  key: string
  startAngle: number
  endAngle: number
}

const FULL_TURN = 360

/**
 * One arc per non-zero slice, in the order given.
 *
 * The final arc is closed to exactly 360°. With the counts this is given —
 * integers accumulated in the same order they were summed — the ratio is
 * already exactly one and the pin changes nothing; it is kept so that closure
 * is a property of the function rather than of its callers' inputs.
 */
export function donutArcs(slices: readonly { key: string; value: number }[]): DonutArc[] {
  const drawable = slices.filter((slice) => slice.value > 0)
  const total = drawable.reduce((sum, slice) => sum + slice.value, 0)
  if (total <= 0) return []

  const arcs: DonutArc[] = []
  let consumed = 0

  drawable.forEach((slice, index) => {
    const startAngle = (consumed / total) * FULL_TURN
    consumed += slice.value

    arcs.push({
      key: slice.key,
      startAngle,
      endAngle: index === drawable.length - 1
        ? FULL_TURN
        : (consumed / total) * FULL_TURN,
    })
  })

  return arcs
}

function polar(cx: number, cy: number, radius: number, angle: number) {
  // SVG measures from three o'clock; the ring starts at twelve.
  const radians = ((angle - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) }
}

const round = (value: number) => Math.round(value * 1000) / 1000

/**
 * The `d` for one wedge, as a stroked arc rather than a filled shape.
 *
 * A single arc command cannot draw a complete circle — its start and end points
 * would coincide and nothing would be swept — so a slice that is the whole ring
 * is drawn as two half turns.
 */
export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const span = endAngle - startAngle

  if (span >= FULL_TURN) {
    const top = polar(cx, cy, radius, 0)
    const bottom = polar(cx, cy, radius, 180)
    return `M ${String(round(top.x))} ${String(round(top.y))} `
      + `A ${String(radius)} ${String(radius)} 0 1 1 ${String(round(bottom.x))} ${String(round(bottom.y))} `
      + `A ${String(radius)} ${String(radius)} 0 1 1 ${String(round(top.x))} ${String(round(top.y))}`
  }

  const from = polar(cx, cy, radius, startAngle)
  const to = polar(cx, cy, radius, endAngle)
  const largeArc = span > 180 ? 1 : 0

  return `M ${String(round(from.x))} ${String(round(from.y))} `
    + `A ${String(radius)} ${String(radius)} 0 ${String(largeArc)} 1 `
    + `${String(round(to.x))} ${String(round(to.y))}`
}
