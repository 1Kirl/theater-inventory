/**
 * Where a QR label points.
 *
 * A printed label outlives the browser that produced it, so the URL it carries
 * cannot come from wherever the app happened to be running. A label printed on
 * a laptop during development would otherwise say `localhost:5173` and be
 * unscannable on every phone in the building, permanently.
 *
 * So the origin is a constant with an optional override, not `window.location`.
 */

/**
 * The deployed application. Labels always point here.
 *
 * A plain constant rather than required configuration: it is public, it is
 * already in the README, and making it an environment variable would mean every
 * developer needs one more line in `.env.local` before printing works. The
 * override exists for the day the project moves to its own domain.
 */
const DEFAULT_APP_ORIGIN = 'https://theater-inventory.web.app'

/** Trailing slashes make `${origin}/equipment/...` produce a double slash. */
function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/**
 * An override that is safe to put on a sticker, or nothing.
 *
 * The override is configuration, not user input, but the thing it produces gets
 * printed and stuck to equipment — an unscannable or hostile label cannot be
 * recalled. A typo should cost a wrong deployment origin at worst, never a
 * `javascript:` URL in a QR code that somebody's phone then offers to open.
 *
 * So it must be an absolute `https:` URL and nothing more: no other scheme, no
 * embedded credentials, no path, query, or fragment to graft the equipment path
 * onto. Anything else is discarded in favour of the known-good default, because
 * refusing to print is worse than printing the canonical origin.
 */
function validOriginOverride(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    // Not absolute, or not a URL at all — `evil.com`, `//evil`, `not a url`.
    return null
  }

  // `javascript:`, `data:`, and `http:` alike. A label is scanned by a camera
  // that will happily follow whatever scheme it is handed.
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname.length === 0) return null
  if (parsed.username.length > 0 || parsed.password.length > 0) return null
  if (parsed.search.length > 0 || parsed.hash.length > 0) return null
  // `https://host/some/path` would produce `/some/path/equipment/<id>`, which
  // resolves to nothing.
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null

  return parsed.origin
}

/**
 * The canonical origin for printed links.
 *
 * `VITE_PUBLIC_APP_ORIGIN` is read by name, never by spreading
 * `import.meta.env` — decision 50a: a bare reference is inlined by Vite as an
 * object holding every `VITE_` variable, which is how a debug token once
 * reached a production bundle. It is public by nature and has a safe fallback,
 * so nothing breaks when it is absent or wrong.
 */
export function publicAppOrigin(): string {
  return validOriginOverride(import.meta.env.VITE_PUBLIC_APP_ORIGIN) ?? DEFAULT_APP_ORIGIN
}

/**
 * The URL a unit's QR code encodes.
 *
 * The unit's document id, never its asset code. An asset code is a label
 * somebody chose and may re-choose: renaming `MIC-017` to `MIC-A17` must not
 * turn every printed sticker into a dead link. The document id is the one thing
 * about a unit that cannot change.
 *
 * Nothing else goes in. The QR is a pointer into an application that will ask
 * who you are; it is not a credential and carries no information about the
 * equipment beyond which one it is.
 */
export function equipmentQrUrl(unitId: string, origin = publicAppOrigin()): string {
  const id = unitId.trim()
  if (id.length === 0) {
    throw new Error('A unit id is required to build an equipment link.')
  }

  return `${normalizeOrigin(origin)}/equipment/${encodeURIComponent(id)}`
}
