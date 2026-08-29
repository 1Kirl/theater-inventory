/**
 * What a scanning session remembers.
 *
 * A camera decoding at ten frames a second will read the same sticker dozens of
 * times while somebody holds a microphone steady, and each of those reads must
 * not become a lifecycle write. Two separate guards do that, because they fail
 * differently:
 *
 * - the session itself, so a unit already handled is recognised and skipped
 * - an in-flight set, so a unit whose write has started but not finished is
 *   skipped even though no result exists yet
 *
 * The second is the one that matters. Without it, two decodes a few hundred
 * milliseconds apart would both pass the "not in the session" test and start two
 * transactions for the same piece of equipment.
 *
 * All of this is client memory. Nothing here is written to Firestore: a scan is
 * an act of looking at equipment, and the lifecycle events the writes produce
 * are already the authoritative history of what happened to it.
 */

export const SCAN_MODES = ['inspect', 'check_out', 'check_in'] as const
export type ScanMode = (typeof SCAN_MODES)[number]

export const SCAN_MODE_LABELS: Record<ScanMode, string> = {
  inspect: 'Inspect',
  check_out: 'Check out',
  check_in: 'Check in',
}

/** Whether a mode writes. Inspect never does. */
export function modeMutates(mode: ScanMode): boolean {
  return mode !== 'inspect'
}

export type ScanOutcome = 'processing' | 'success' | 'warning' | 'failed'

export interface ScanEntry {
  unitId: string
  /** Filled in once the unit is read; null while the id is all that is known. */
  assetCode: string | null
  itemName: string | null
  outcome: ScanOutcome
  message: string
  /** Client clock, for display order only. Never stored. */
  at: number
}

export interface ScanSession {
  mode: ScanMode
  /** Most recent first, which is what somebody glancing at a phone wants. */
  entries: readonly ScanEntry[]
  /** Units whose write has started and not yet finished. */
  inFlight: readonly string[]
}

export function emptySession(mode: ScanMode): ScanSession {
  return { mode, entries: [], inFlight: [] }
}

export type ScanAdmission =
  | { admit: true }
  | { admit: false; reason: 'in_flight' | 'already_scanned'; entry: ScanEntry | null }

/**
 * Whether a freshly decoded unit should be acted on.
 *
 * Called on every decode, so it must be cheap and must say no far more often
 * than yes.
 */
export function admitScan(session: ScanSession, unitId: string): ScanAdmission {
  if (session.inFlight.includes(unitId)) {
    return { admit: false, reason: 'in_flight', entry: null }
  }

  const existing = session.entries.find((entry) => entry.unitId === unitId)
  if (existing) {
    return { admit: false, reason: 'already_scanned', entry: existing }
  }

  return { admit: true }
}

/** Marks a unit as being worked on, with a row the user can already see. */
export function beginScan(session: ScanSession, params: {
  unitId: string
  at: number
}): ScanSession {
  const entry: ScanEntry = {
    unitId: params.unitId,
    assetCode: null,
    itemName: null,
    outcome: 'processing',
    message: 'Reading…',
    at: params.at,
  }

  return {
    ...session,
    entries: [entry, ...session.entries],
    inFlight: [...session.inFlight, params.unitId],
  }
}

/** Replaces the placeholder row with what actually happened. */
export function completeScan(session: ScanSession, params: {
  unitId: string
  outcome: Exclude<ScanOutcome, 'processing'>
  message: string
  assetCode?: string | null
  itemName?: string | null
}): ScanSession {
  return {
    ...session,
    entries: session.entries.map((entry) => (
      entry.unitId === params.unitId
        ? {
          ...entry,
          outcome: params.outcome,
          message: params.message,
          assetCode: params.assetCode ?? entry.assetCode,
          itemName: params.itemName ?? entry.itemName,
        }
        : entry
    )),
    inFlight: session.inFlight.filter((id) => id !== params.unitId),
  }
}

/**
 * Drops one unit from the session so the camera may act on it again.
 *
 * The deliberate way back in. A failed write is worth retrying — a permission
 * error somebody then fixes, a network blip — and locking it out for the rest of
 * the session would mean closing the scanner to try again. Retrying is never
 * automatic, because a unit sitting in frame would retry forever.
 */
export function forgetScan(session: ScanSession, unitId: string): ScanSession {
  return {
    ...session,
    entries: session.entries.filter((entry) => entry.unitId !== unitId),
    // Deliberately does not touch `inFlight`: a write already in progress will
    // finish and must still be allowed to remove itself.
    inFlight: session.inFlight,
  }
}

export function clearSession(session: ScanSession): ScanSession {
  // The mode survives, because clearing a list is not a change of intent.
  return { mode: session.mode, entries: [], inFlight: [] }
}

/** Changing intent starts a fresh session; results from another mode would lie. */
export function switchMode(session: ScanSession, mode: ScanMode): ScanSession {
  return session.mode === mode ? session : emptySession(mode)
}

export interface SessionCounts {
  total: number
  success: number
  warning: number
  failed: number
  processing: number
}

export function sessionCounts(session: ScanSession): SessionCounts {
  const counts: SessionCounts = {
    total: session.entries.length, success: 0, warning: 0, failed: 0, processing: 0,
  }
  for (const entry of session.entries) counts[entry.outcome] += 1
  return counts
}
