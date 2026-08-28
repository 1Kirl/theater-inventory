import { paths } from '@/routes/paths'

/**
 * Where a redirect through sign-in should come back to.
 *
 * Three components hand this value between them — the guard that intercepts a
 * request, the sign-in screen, and organization selection — and a deep link
 * survives only if all three agree on what it looks like. So there is one
 * representation and one validator, and neither is duplicated.
 *
 * The representation is a plain internal path: `pathname + search + hash`, never
 * a React Router `Location` object. An object would be discarded silently by the
 * string validator at the far end, which is precisely the sort of quiet mismatch
 * that loses somebody's destination between two correct-looking components.
 */

/** A router location, reduced to the canonical internal path. */
export function locationToReturnPath(location: {
  pathname: string
  search?: string | undefined
  hash?: string | undefined
}): string {
  return `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`
}

/**
 * Validates a return path.
 *
 * Only somewhere inside this application. A value carried through a redirect is
 * attacker-controllable in general, and sending people to an arbitrary URL after
 * they type a password is how phishing works — so anything that is not a plain
 * internal path is discarded rather than corrected.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const path = value.trim()
  if (path.length === 0) return null

  // Must be rooted, and must not be protocol-relative (`//evil.example.com`)
  // or carry a scheme of its own.
  if (!path.startsWith('/')) return null
  if (path.startsWith('//')) return null
  if (path.includes('\\')) return null
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return null

  return path
}

/** The destination a guard stored, if it stored a usable one. */
export function returnToFromState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null
  return safeReturnPath((state as { from?: unknown }).from)
}

/**
 * Where somebody who has just signed in belongs.
 *
 * Both the sign-in screen and the guard that keeps signed-in people away from it
 * use this, and that is the point. They fire within a frame of each other after
 * authentication — the guard's redirect is mounted by the auth state update, the
 * screen's by its own submit handler — and whichever lands last decides the URL.
 * When they disagree, the deep link is lost; sharing one answer makes the race
 * harmless rather than trying to win it.
 *
 * With no destination stored, this is ordinary sign-in and organization
 * selection is where people go.
 */
export function afterAuthDestination(state: unknown): string {
  return returnToFromState(state) ?? paths.organizations
}
