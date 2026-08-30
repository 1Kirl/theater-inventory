/**
 * Which single navigation entry the current URL belongs to.
 *
 * React Router's `NavLink` decides this per link, and its default is prefix
 * matching. That is almost always what you want and here it was wrong twice
 * over, because one destination lives underneath another:
 *
 *     Inventory  /inventory
 *     Scan       /inventory/scan
 *
 * On `/inventory/scan` both links matched, so both lit up. Turning prefix
 * matching off for Inventory would have fixed the symptom and broken the item
 * detail routes, which are also nested and *should* keep Inventory lit.
 *
 * So the decision is made once, for the whole bar, instead of independently per
 * link: every entry whose path is a segment prefix of the URL is a candidate,
 * and the most specific one wins. `/inventory/scan` is matched by both entries
 * and `/inventory/scan` is longer, so Scan takes it. `/inventory/abc123` is
 * matched only by `/inventory`, so Inventory keeps it.
 *
 * Because exactly one path is returned, two entries cannot be active at once —
 * that is a property of the shape of the answer, not of the styling.
 */

/** Trailing slashes and any query or hash a caller happened to include. */
function normalize(pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] ?? ''
  if (path === '' ) return '/'
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * Whether a URL belongs to a destination.
 *
 * Segment-wise, so `/inventory` claims `/inventory/new` but not `/inventory-x`.
 *
 * The root is spelled out as exact-only. The segment rule already gives that
 * answer — `/calendar` does not start with `//` — so the line is redundant, and
 * it is kept because "the root matches only itself" is a rule a reader should
 * not have to derive from a string comparison.
 */
function covers(candidate: string, pathname: string): boolean {
  const path = normalize(candidate)
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

/**
 * The one navigation path that should read as active, or null when the URL
 * belongs to none of them.
 *
 * Null is a real answer rather than a failure: the equipment deep link at
 * `/equipment/:unitId` deliberately sits outside the module routes, and no
 * entry claiming it is correct.
 */
export function activeNavPath(
  pathname: string,
  candidates: readonly string[],
): string | null {
  const current = normalize(pathname)

  let best: string | null = null

  for (const candidate of candidates) {
    if (!covers(candidate, current)) continue
    // Most specific wins. Equal lengths would mean duplicate entries, which the
    // navigation does not have.
    if (best === null || normalize(candidate).length > normalize(best).length) {
      best = candidate
    }
  }

  return best
}

/** Whether this entry is the active one. Never true for two entries at once. */
export function isNavItemActive(
  itemPath: string,
  pathname: string,
  candidates: readonly string[],
): boolean {
  return activeNavPath(pathname, candidates) === itemPath
}
