import { FirebaseError } from 'firebase/app'
import { parseAppQr } from '@/domain/equipment-qr'
import { planScan, successMessage } from '@/features/scanner/scan-actions'
import {
  admitScan, beginScan, clearSession, completeScan, emptySession, forgetScan, switchMode,
  type ScanMode, type ScanSession,
} from '@/features/scanner/scan-session'
import type { LifecycleAction } from '@/services/unit-lifecycle-service'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'

/**
 * One decoded string, all the way to a lifecycle write.
 *
 * This owns the session rather than React, for one reason: admission has to be
 * synchronous. A camera can deliver the same code twice in the same tick, and if
 * the check for "have we already got this one" read a value React had not
 * re-rendered yet, both would pass and two transactions would start for the same
 * microphone. Here the session is a plain variable, and claiming a unit happens
 * in the same turn as the check.
 *
 * Everything the outside world does is injected, so all of this can be tested
 * without a camera, a network, or Firestore.
 */

export interface ScanRunnerDeps {
  readUnit: (unitId: string) => Promise<InventoryUnit | null>
  readItem: (itemId: string) => Promise<InventoryItem | null>
  perform: (action: LifecycleAction) => Promise<void>
  now: () => number
}

export interface ScanContext {
  activeOrganizationId: string | null
  usingTeamId: string | null
  usingMemberUid: string | null
}

const INVALID_QR = 'That QR code is not a Theater Inventory label.'
const UNAVAILABLE = 'We couldn’t open this equipment. It may not exist, or it may belong to '
  + 'an organization you do not have access to.'
const DENIED = 'You don’t have permission to update this equipment.'
const ITEM_SCANNED = 'That is an inventory item label. Open it to see the record.'
const GENERIC_FAILURE = 'That did not work. Try scanning it again.'

/** Firebase errors never reach a person; a scanner in a dark room least of all. */
function failureMessage(error: unknown): string {
  if (error instanceof FirebaseError && error.code === 'permission-denied') return DENIED
  if (error instanceof Error && !('code' in error) && error.message.trim().length > 0) {
    // Domain refusals from the lifecycle service already read as sentences.
    return error.message
  }
  return GENERIC_FAILURE
}

export type DecodeRejection =
  | { kind: 'invalid_qr'; message: string }
  | { kind: 'duplicate'; unitId: string; message: string }
  /**
   * A real label, for an inventory record rather than a physical unit.
   *
   * Not an error, and not a session entry either. The scanner's three modes are
   * lifecycle actions and a bulk item has no lifecycle to act on — there is no
   * unit to check out, because the quantity is a number rather than a set of
   * identities. Offering Check Out here would be a control that writes nothing.
   *
   * So the scan is reported back with the item it names, and the page turns it
   * into a way to open that item. Recognised, and honest about what it is.
   */
  | { kind: 'item'; itemId: string; message: string }

export interface ScanRunner {
  getSession: () => ScanSession
  subscribe: (listener: (session: ScanSession) => void) => () => void
  setMode: (mode: ScanMode) => void
  /**
   * Handles one decoded value. Returns immediately: admission is synchronous,
   * the rest is not. A rejection is returned rather than recorded, because a
   * code sitting in front of the lens produces one of these ten times a second
   * and none of them belongs in the session list.
   */
  handleDecoded: (raw: string) => DecodeRejection | null
  forget: (unitId: string) => void
  clear: () => void
}

export function createScanRunner(params: {
  deps: ScanRunnerDeps
  getContext: () => ScanContext
  initialMode?: ScanMode
}): ScanRunner {
  let session = emptySession(params.initialMode ?? 'inspect')
  const listeners = new Set<(session: ScanSession) => void>()

  function update(next: ScanSession) {
    session = next
    for (const listener of listeners) listener(session)
  }

  async function process(unitId: string) {
    const context = params.getContext()

    let unit: InventoryUnit | null
    try {
      unit = await params.deps.readUnit(unitId)
    } catch {
      // Denied and absent are indistinguishable by design — Rules refuse a read
      // of a document that does not exist — so both say the same thing.
      update(completeScan(session, { unitId, outcome: 'failed', message: UNAVAILABLE }))
      return
    }

    if (!unit) {
      update(completeScan(session, { unitId, outcome: 'failed', message: UNAVAILABLE }))
      return
    }

    const item = await params.deps.readItem(unit.inventory_item_id).catch(() => null)
    const identity = { assetCode: unit.asset_code, itemName: item?.name ?? null }

    const plan = planScan({
      mode: session.mode,
      unit,
      activeOrganizationId: context.activeOrganizationId,
      usingTeamId: context.usingTeamId,
    })

    if (plan.kind === 'refuse') {
      update(completeScan(session, {
        unitId, outcome: plan.outcome, message: plan.message, ...identity,
      }))
      return
    }

    if (plan.kind === 'inspect') {
      update(completeScan(session, {
        unitId, outcome: 'success', message: successMessage('inspect', unit), ...identity,
      }))
      return
    }

    try {
      // One unit, one transaction, through the service that already knows how to
      // move a unit and keep its parent's counters, its planned repair, and its
      // history intact. Nothing about that logic is repeated here.
      await params.deps.perform({
        unit,
        to: plan.to,
        usingTeamId: plan.to === 'in_use' ? context.usingTeamId : null,
        usingMemberUid: plan.to === 'in_use' ? context.usingMemberUid : null,
      })
    } catch (caught) {
      update(completeScan(session, {
        unitId, outcome: 'failed', message: failureMessage(caught), ...identity,
      }))
      return
    }

    update(completeScan(session, {
      unitId, outcome: 'success', message: successMessage(session.mode, unit), ...identity,
    }))
  }

  return {
    getSession: () => session,

    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    setMode(mode) {
      update(switchMode(session, mode))
    },

    handleDecoded(raw) {
      const label = parseAppQr(raw)
      if (label === null) return { kind: 'invalid_qr', message: INVALID_QR }

      if (label.kind === 'item') {
        return { kind: 'item', itemId: label.itemId, message: ITEM_SCANNED }
      }

      const { unitId } = label

      const admission = admitScan(session, unitId)
      if (!admission.admit) {
        const seen = admission.entry
        return {
          kind: 'duplicate',
          unitId,
          message: seen?.assetCode
            ? `${seen.assetCode} is already in this scan session.`
            : 'That equipment is already in this scan session.',
        }
      }

      // Claimed in the same turn as the check, before any await. This is what
      // makes a second decode in the same tick impossible to admit.
      update(beginScan(session, { unitId, at: params.deps.now() }))
      void process(unitId)
      return null
    },

    forget(unitId) {
      update(forgetScan(session, unitId))
    },

    clear() {
      update(clearSession(session))
    },
  }
}
