import { OrganizationError } from '@/domain/organization-errors'
import { toUserFacingMessage } from '@/services/auth-errors'

/**
 * Domain failures already carry a message written for the person reading it.
 * Anything else falls back to the shared Firebase mapping, so a raw error code
 * never reaches the interface.
 */
export function toOrganizationErrorMessage(error: unknown): string {
  if (error instanceof OrganizationError) {
    return error.message
  }

  return toUserFacingMessage(error)
}
