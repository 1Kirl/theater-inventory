import { FirebaseError } from 'firebase/app'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryUnit } from '@/types/inventory'

/**
 * What somebody sees after opening a scanned equipment label.
 *
 * A QR sticker is the least controlled entry point this product has: anyone
 * holding the equipment can photograph it, and the URL carries no credential.
 * The page it opens is also the only one in the application that cannot be
 * placed under the active organization's guards, because which organization
 * owns the equipment is a fact stored in the unit — not something the route
 * knows beforehand. So this is where that gets worked out.
 *
 * Security Rules gate the unit read on `resource.data.organization_id`, and a
 * document that does not exist has no `resource` — the read is denied rather
 * than returning an empty snapshot. That is verified in the Rules tests, and it
 * means the client genuinely cannot tell "this equipment does not exist" from
 * "this equipment is not yours". Reporting them as one outcome is not vagueness
 * for its own sake; it is the only truthful thing to say, and it is what stops
 * a stranger with a scanner from confirming that a guessed id is real.
 */
export type EquipmentScanOutcome =
  /** Still reading — the unit, or the organization the browser has open. */
  | { kind: 'resolving' }
  /** The unit loaded and belongs to the organization currently open. */
  | { kind: 'ready'; unit: InventoryUnit }
  /** Readable, but not in the organization the browser currently has open. */
  | {
    kind: 'other_organization'
    organizationId: string
    /** False when no organization is open at all, which reads differently. */
    hasActiveOrganization: boolean
  }
  /** Denied, or absent. The two cannot be told apart, and are not. */
  | { kind: 'unavailable'; message: string }
  /** Something else went wrong — offline, most likely. */
  | { kind: 'error'; message: string }

/**
 * Says nothing it cannot prove. "This equipment does not exist" would be a claim
 * the client has no way to check, and confirming which ids are real is exactly
 * what a stranger with a scanner would want.
 */
const UNAVAILABLE_MESSAGE = 'We couldn’t open this equipment. '
  + 'It may not exist, or it may belong to an organization you do not have access to.'

export function equipmentScanOutcome(params: {
  /** `undefined` while the read is in flight. */
  unit: InventoryUnit | null | undefined
  error: unknown
  activeOrganizationId: string | null
  /** True while the browser's active organization is still being resolved. */
  organizationLoading: boolean
}): EquipmentScanOutcome {
  if (params.error !== null && params.error !== undefined) {
    // Denial is the expected answer to a scan by the wrong person, so it is not
    // an error screen. Anything else is.
    if (params.error instanceof FirebaseError && params.error.code === 'permission-denied') {
      return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE }
    }
    return { kind: 'error', message: toOrganizationErrorMessage(params.error) }
  }

  if (params.unit === undefined) {
    return { kind: 'resolving' }
  }

  if (!params.unit) {
    // Unreachable while Rules deny missing documents, and kept deliberately:
    // if that ever changes, an absent unit must still say what a denied one
    // says rather than falling through to a blank page.
    return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE }
  }

  if (params.organizationLoading) {
    // The unit is in hand but the browser's organization is not settled yet.
    // Comparing now would briefly accuse a perfectly ordinary in-app visit of
    // belonging to another organization, and flash a switch card at somebody
    // who simply clicked through from the item page.
    return { kind: 'resolving' }
  }

  if (params.unit.organization_id !== params.activeOrganizationId) {
    // Reading it succeeded, so this person is a member of the owning
    // organization with inventory access — Rules said so. The only thing wrong
    // is which organization the browser currently has open, and that is a
    // one-tap fix rather than a refusal.
    return {
      kind: 'other_organization',
      organizationId: params.unit.organization_id,
      hasActiveOrganization: params.activeOrganizationId !== null,
    }
  }

  return { kind: 'ready', unit: params.unit }
}
