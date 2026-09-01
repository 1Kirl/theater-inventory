import { FirebaseError } from 'firebase/app'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'

/**
 * Opening an organization-owned record from a link that carries only its id.
 *
 * A printed QR is the case this exists for. The label knows which record it
 * points at and nothing else — not which organization owns it, and certainly
 * not which organization the browser happens to have open. Somebody in two
 * programs, holding equipment from the one that is not currently active, is a
 * legitimate scan that any guard bound to the active organization would refuse
 * before the page could read the record and find out.
 *
 * So the resolution happens after the read, here, in a pure function shared by
 * every record type that has a label. Units had this from Phase 11E; items got
 * labels in 11I and got the same treatment rather than a second, subtly
 * different one.
 *
 * Security Rules gate the read on the record's own `organization_id`. A
 * successful read therefore already proves membership and module access in the
 * owning organization, and a failed one yields a message that deliberately does
 * not distinguish "denied" from "does not exist" — because Rules cannot tell
 * the client apart either, and pretending otherwise would let a stranger with a
 * scanner confirm which ids are real.
 */

export type DeepLinkOutcome<T> =
  /** Still reading — the record, or the organization the browser has open. */
  | { kind: 'resolving' }
  /** Loaded, and it belongs to the organization currently open. */
  | { kind: 'ready'; record: T }
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

export function resolveDeepLink<T extends { organization_id: string }>(params: {
  /** `undefined` while the read is in flight. */
  record: T | null | undefined
  error: unknown
  activeOrganizationId: string | null
  /** True while the browser's active organization is still being resolved. */
  organizationLoading: boolean
  /** Said for both denied and absent, so the two stay indistinguishable. */
  unavailableMessage: string
}): DeepLinkOutcome<T> {
  if (params.error !== null && params.error !== undefined) {
    // Denial is the expected answer to a scan by the wrong person, so it is not
    // an error screen. Anything else is.
    if (params.error instanceof FirebaseError && params.error.code === 'permission-denied') {
      return { kind: 'unavailable', message: params.unavailableMessage }
    }
    return { kind: 'error', message: toOrganizationErrorMessage(params.error) }
  }

  if (params.record === undefined) {
    return { kind: 'resolving' }
  }

  if (!params.record) {
    // Unreachable while Rules deny missing documents, and kept deliberately: if
    // that ever changes, an absent record must still say what a denied one says
    // rather than falling through to a blank page.
    return { kind: 'unavailable', message: params.unavailableMessage }
  }

  if (params.organizationLoading) {
    // The record is in hand but the browser's organization is not settled yet.
    // Comparing now would briefly accuse a perfectly ordinary in-app visit of
    // belonging to another organization, and flash a switch card at somebody
    // who simply clicked through from a list.
    return { kind: 'resolving' }
  }

  if (params.record.organization_id !== params.activeOrganizationId) {
    // Reading it succeeded, so this person is a member of the owning
    // organization with the module — Rules said so. The only thing wrong is
    // which organization the browser currently has open, and that is a one-tap
    // fix rather than a refusal.
    return {
      kind: 'other_organization',
      organizationId: params.record.organization_id,
      hasActiveOrganization: params.activeOrganizationId !== null,
    }
  }

  return { kind: 'ready', record: params.record }
}
