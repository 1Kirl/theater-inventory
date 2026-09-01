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
 * path separator. A segment that does is not a document id however it was
 * encoded.
 */
function isPlausibleDocumentId(value: string): boolean {
  return value.trim().length > 0 && !value.includes('/') && !value.includes('\\')
}

/** Application routes under `/inventory/` that are pages rather than records. */
const RESERVED_INVENTORY_SEGMENTS = new Set(['new', 'scan'])

/**
 * What a label turned out to point at.
 *
 * Two kinds, because there are two kinds of label. A unit label names one
 * physical piece and supports the lifecycle actions; an item label names an
 * inventory record and supports none of them, which is why the difference is in
 * the type rather than left for a caller to infer from the id.
 */
export type ScannedLabel =
  | { kind: 'unit'; unitId: string }
  | { kind: 'item'; itemId: string }

/**
 * Read any of this application's labels.
 *
 * Every check the unit-only parser made still applies, unchanged — exact host,
 * https only, no credentials, no query, no fragment, exactly two path segments.
 * The only thing that widened is which first segment is accepted, and it is a
 * closed set of two rather than "anything on our host".
 */
export function parseAppQr(value: unknown, origin = publicAppOrigin()): ScannedLabel | null {
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

  // Exactly two segments, no more. `/equipment/a/b` is not a unit, and
  // `/inventory` on its own is the list page rather than a label.
  const segments = scanned.pathname.split('/').filter((part) => part.length > 0)
  if (segments.length !== 2) return null

  const prefix = segments[0]
  if (prefix !== 'equipment' && prefix !== 'inventory') return null

  let id: string
  try {
    id = decodeURIComponent(segments[1] ?? '')
  } catch {
    // A stray percent sign. Not something our generator produces.
    return null
  }

  if (!isPlausibleDocumentId(id)) return null

  // `/inventory/new` and `/inventory/scan` are real application routes that
  // happen to fit the shape. Neither is a document, and printing a label for one
  // is impossible, so a scan claiming to be one is refused.
  if (prefix === 'inventory' && RESERVED_INVENTORY_SEGMENTS.has(id)) return null

  return prefix === 'equipment' ? { kind: 'unit', unitId: id } : { kind: 'item', itemId: id }
}

/**
 * A unit label, or nothing.
 *
 * Kept for the callers that genuinely accept only a unit, so an item label is a
 * refusal there rather than something they have to remember to check for.
 */
export function parseEquipmentQr(value: unknown, origin = publicAppOrigin()): string | null {
  const parsed = parseAppQr(value, origin)
  return parsed?.kind === 'unit' ? parsed.unitId : null
}
