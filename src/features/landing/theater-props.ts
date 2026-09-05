/**
 * What falls, how much of it, and how heavy it is.
 *
 * Separated from the component because these are the decisions worth being
 * able to check: the density policy, the recycling bound, and the physical
 * feel. The component below owns the engine and the DOM, neither of which is
 * testable without a browser.
 */

/**
 * The props themselves — production equipment only.
 *
 * Native Unicode, rendered by whatever emoji font the visitor's platform
 * already has. Nothing is bundled and no artwork is copied: an Apple device
 * draws Apple's, a Windows one draws Segoe's, and both are correct.
 */
export const THEATER_PROPS = ['💡', '🎤', '🎧', '🎬', '📷', '🎥', '🔧', '🧰', '📋', '📽️'] as const

export type TheaterProp = (typeof THEATER_PROPS)[number]

/** Below this width a phone is assumed, and the atmosphere thins out. */
export const NARROW_VIEWPORT = 768

export interface DensityPolicy {
  /** How many fall during the opening cascade. */
  initial: number
  /** Ceiling on live bodies. The oldest is recycled before a new one spawns. */
  maximum: number
  /** Rendered size range in pixels; every prop picks its own within it. */
  minSize: number
  maxSize: number
  /** Milliseconds between the occasional later drops. */
  minInterval: number
  maxInterval: number
}

/**
 * Density from the viewport's width.
 *
 * A width comparison rather than a media query, because the JavaScript
 * media-query API is banned across `src/` and reduced motion is settled in CSS
 * instead. The width is
 * read once at start and again on resize, never per frame.
 */
export function densityFor(viewportWidth: number): DensityPolicy {
  if (viewportWidth < NARROW_VIEWPORT) {
    // A phone shows the whole pile at once and has the least room to spare, so
    // it gets fewer, smaller props and longer gaps between them.
    return {
      initial: 10, maximum: 13,
      minSize: 26, maxSize: 42,
      minInterval: 7_000, maxInterval: 12_000,
    }
  }

  return {
    initial: 28, maximum: 34,
    minSize: 36, maxSize: 66,
    minInterval: 4_000, maxInterval: 8_000,
  }
}

/**
 * How big the collision circle is, relative to the prop's font size.
 *
 * An emoji glyph is drawn well outside its em box — measured at roughly 1.37
 * times the font size across this set — so a body of `size / 2` lets the
 * visible artwork hang up to fifty pixels below the floor it is supposedly
 * resting on. Sizing the circle to the glyph rather than to the em box is what
 * makes a prop come to rest on the bottom edge instead of through it, and it
 * has the useful side effect of making props meet each other sooner.
 */
export const GLYPH_RADIUS_RATIO = 0.68

/**
 * How many props the settled, reduced-motion arrangement uses.
 *
 * Where they sit is `landing.css`'s business, not this file's — the component
 * renders the same markup either way and the stylesheet decides what it looks
 * like, which is the same division the rest of this page uses.
 */
export const STATIC_PROP_COUNT = 5

/**
 * Soft but weighty.
 *
 * Low restitution and real friction are what let a pile stand up: bouncier
 * bodies skitter apart and never settle, and frictionless ones slide out from
 * under each other. `frictionAir` is the reason a prop falls rather than
 * plummets, and `slop` a little above the default keeps resting contacts quiet
 * instead of jittering.
 */
export const PHYSICS = {
  gravity: 1.1,
  restitution: 0.28,
  friction: 0.42,
  frictionStatic: 0.6,
  frictionAir: 0.018,
  density: 0.0012,
  slop: 0.05,
  /** Bodies stop being simulated once they have been still this long. */
  sleepThreshold: 60,
} as const

/** Entrance spread, in milliseconds. Nothing shares a frame with anything. */
export const CASCADE_MS = 1_600

export interface SpawnState {
  x: number
  y: number
  angle: number
  velocityX: number
  angularVelocity: number
  size: number
  prop: TheaterProp
}

/**
 * One prop's starting condition.
 *
 * `random` is passed in rather than called, so the distribution can be checked
 * without waiting on chance. The x range is inset from both walls: a prop
 * spawned hard against one arrives already in contact with it, which reads as a
 * glitch rather than as a drop.
 */
export function spawnFor(
  viewportWidth: number,
  policy: DensityPolicy,
  random: () => number,
): SpawnState {
  const size = policy.minSize + random() * (policy.maxSize - policy.minSize)

  /*
   * Where a prop enters, and why it is not the whole width.
   *
   * Spread across the full viewport, twenty-eight props on a wide screen land
   * as a single flat row one prop deep — they never meet, so nothing ever
   * stacks. Dropping them down a central band makes them arrive on top of each
   * other, and the pile then spreads outwards on its own as bodies roll off
   * one another, which is the shape that reads as a pile rather than as a
   * border. The band is still most of the screen, so this is a bias rather
   * than a column.
   */
  const band = viewportWidth * SPAWN_BAND
  const margin = (viewportWidth - band) / 2 + size / 2

  return {
    x: margin + random() * Math.max(1, band - size),
    // Above the top edge, far enough that it is already moving when it enters.
    y: -size * 2 - random() * 120,
    angle: (random() - 0.5) * 0.7,
    // Restrained on purpose. A circular body converts sideways travel into
    // roll the moment it meets the floor, so a generous initial nudge is what
    // leaves half the set resting upside down.
    velocityX: (random() - 0.5) * 1.1,
    angularVelocity: (random() - 0.5) * 0.06,
    size,
    prop: THEATER_PROPS[Math.floor(random() * THEATER_PROPS.length)] ?? THEATER_PROPS[0],
  }
}

/**
 * The share of the viewport props fall into.
 *
 * Wide enough to stay random, narrow enough that they meet on the way down.
 */
export const SPAWN_BAND = 0.62

/** Milliseconds until the next drop, from the current time rather than a queue. */
export function nextDropDelay(policy: DensityPolicy, random: () => number): number {
  return policy.minInterval + random() * (policy.maxInterval - policy.minInterval)
}
