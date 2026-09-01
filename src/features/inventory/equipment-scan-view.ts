import { resolveDeepLink } from '@/features/inventory/record-deep-link'
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
  | { kind: 'resolving' }
  | { kind: 'ready'; unit: InventoryUnit }
  | {
    kind: 'other_organization'
    organizationId: string
    hasActiveOrganization: boolean
  }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }

/**
 * Says nothing it cannot prove. "This equipment does not exist" would be a claim
 * the client has no way to check, and confirming which ids are real is exactly
 * what a stranger with a scanner would want.
 */
const UNAVAILABLE_MESSAGE = 'We couldn\u2019t open this equipment. '
  + 'It may not exist, or it may belong to an organization you do not have access to.'

export function equipmentScanOutcome(params: {
  /** `undefined` while the read is in flight. */
  unit: InventoryUnit | null | undefined
  error: unknown
  activeOrganizationId: string | null
  /** True while the browser's active organization is still being resolved. */
  organizationLoading: boolean
}): EquipmentScanOutcome {
  const outcome = resolveDeepLink({
    record: params.unit,
    error: params.error,
    activeOrganizationId: params.activeOrganizationId,
    organizationLoading: params.organizationLoading,
    unavailableMessage: UNAVAILABLE_MESSAGE,
  })

  // The shared resolver calls it `record`; this has always called it `unit`.
  return outcome.kind === 'ready' ? { kind: 'ready', unit: outcome.record } : outcome
}
