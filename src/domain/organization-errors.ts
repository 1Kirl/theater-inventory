export type OrganizationErrorCode =
  | 'not-signed-in'
  | 'invalid-join-code'
  | 'join-code-not-found'
  | 'join-code-revoked'
  | 'already-a-member'
  | 'membership-deactivated'
  | 'organization-not-found'
  | 'admin-settings-not-found'
  | 'not-admin'
  | 'target-membership-not-found'
  | 'target-membership-inactive'
  | 'already-admin'
  | 'cannot-deactivate-admin'
  | 'invalid-organization-name'
  | 'invalid-team-name'
  | 'invalid-inventory-item'
  | 'invalid-maintenance-record'
  | 'inventory-item-not-found'
  | 'invalid-production'
  | 'invalid-requirement'
  | 'invalid-action-item'
  | 'requirement-not-actionable'
  | 'invalid-calendar-event'
  | 'invalid-inventory-unit'
  | 'promotion-blocked-by-maintenance'
  | 'invalid-lifecycle-action'
  | 'inventory-unit-not-found'

/**
 * Failures the caller is expected to handle and explain, as opposed to the raw
 * Firestore errors that surface when Security Rules reject a write.
 */
export class OrganizationError extends Error {
  readonly code: OrganizationErrorCode

  constructor(code: OrganizationErrorCode, message: string) {
    super(message)
    this.name = 'OrganizationError'
    this.code = code
  }
}

