/**
 * Deterministic document IDs.
 *
 * Composing the ID from the organization and the user is what makes a second
 * membership for the same pair impossible, and what stops a deactivated member
 * from re-joining: the create fails because the document already exists.
 */

export function membershipId(organizationId: string, uid: string): string {
  return `${organizationId}_${uid}`
}

export function joinProofId(organizationId: string, uid: string): string {
  return `${organizationId}_${uid}`
}

export const COLLECTIONS = {
  users: 'users',
  organizations: 'organizations',
  memberships: 'organization_memberships',
  joinCodes: 'organization_join_codes',
  adminSettings: 'organization_admin_settings',
  joinProofs: 'organization_membership_join_proofs',
  teams: 'teams',
  inventoryItems: 'inventory_items',
} as const
