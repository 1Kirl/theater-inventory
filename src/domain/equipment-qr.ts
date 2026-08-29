import { publicAppOrigin } from '@/domain/equipment-links'

/**
 * Reading an equipment label back.
 *
 * The inverse of `equipmentQrUrl`, and the only thing standing between a camera
 * pointed at the world and a lifecycle write. A scanner sees whatever is in
 * front of it — a poster, a shipping label, a QR somebody printed to see what
 * happens — so this refuses everything that is not exactly one of our labels
 * rather than trying to salvage something usable from it.
 *
 * The check is against the canonical origin, never against wherever the
 * application happens to be running. Labels in a storage room point at the
 * deployed site, and a scanner opened on `localhost:5173` during development has
 * to recognise those same labels; comparing to `window.location` would mean
 * nothing scanned during development ever matched.
 */

/**
 * A Firestore document id is never empty, never whitespace, and never contains a
 * path separator. A segment that does is not a unit id however it was encoded.
 */
function isPlausibleUnitId(value: string): boolean {
  return value.trim().length > 0 && !value.includes('/') && !value.includes('\\')
}

export function parseEquipmentQr(value: unknown, origin = publicAppOrigin()): string | null {
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (text.length === 0) return null

  let scanned: URL
  let canonical: URL
  try {
    scanned = new URL(text)
    canonical = new URL(origin)
  } catch {
    // Not a URL at all: a plain asset code, a sentence, a serial number. A bare
    // unit id is deliberately not accepted either — anything that is not a
    // complete label is not a label.
    return null
  }

  // Exact host equality, which is what stops a lookalike. Neither
  // `theater-inventory.web.app.evil.example` nor `theater-inventory.web.app.co`
  // is this host, and neither is a subdomain of it.
  if (scanned.host !== canonical.host) return null

  // Our labels are always https. Accepting http would accept a downgraded
  // reprint of one, and there is no reason for a genuine label to be http.
  if (scanned.protocol !== 'https:') return null

  // Credentials in a URL are a phishing shape, never something we print.
  if (scanned.username.length > 0 || scanned.password.length > 0) return null

  // Nothing we generate carries a query or a fragment. Their presence means the
  // value came from somewhere else — a tracking wrapper, a hand-edited link —
  // so it is refused rather than trimmed down to something that looks right.
  if (scanned.search.length > 0 || scanned.hash.length > 0) return null

  // Exactly `/equipment/{id}`: two segments, no more. `/equipment/a/b` is not a
  // unit, and neither is `/inventory/{id}`.
  const segments = scanned.pathname.split('/').filter((part) => part.length > 0)
  if (segments.length !== 2) return null
  if (segments[0] !== 'equipment') return null

  const encoded = segments[1] ?? ''
  let unitId: string
  try {
    unitId = decodeURIComponent(encoded)
  } catch {
    // A stray percent sign. Not something our generator produces.
    return null
  }

  return isPlausibleUnitId(unitId) ? unitId : null
}
