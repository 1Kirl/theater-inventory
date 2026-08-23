import type { FieldValue } from 'firebase/firestore'
import { EMPTY_PERMISSIONS } from '@/types/organization'

/**
 * The exact document shapes written to Firestore.
 *
 * Security Rules validate these with `hasExactly`, so an extra or missing field
 * is a permission-denied rather than a soft failure. Keeping the shapes here —
 * rather than inline in each service — lets the Rules tests exercise the same
 * payloads the application sends, instead of hand-written fixtures that can
 * drift away from them.
 *
 * `now` is injected so both callers pass `serverTimestamp()`: Rules require
 * these fields to equal `request.time`, which only a server timestamp satisfies.
 */
export type Now = () => FieldValue

export function buildOrganizationDocument(params: {
  organizationId: string
  name: string
  description?: string | undefined
  uid: string
  now: Now
}) {
  const description = params.description?.trim()

  return {
    organization_id: params.organizationId,
    name: params.name,
    ...(description ? { description } : {}),
    admin_uid: params.uid,
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

/**
 * A new membership always starts empty, whether it comes from creating the
 * organization or joining with a code. Rules pin these values on create.
 */
export function buildMembershipDocument(params: {
  organizationId: string
  uid: string
  now: Now
}) {
  return {
    organization_id: params.organizationId,
    uid: params.uid,
    team_ids: [] as string[],
    permissions: EMPTY_PERMISSIONS,
    is_active: true,
    joined_at: params.now(),
    updated_at: params.now(),
  }
}

export function buildJoinCodeDocument(params: {
  organizationId: string
  organizationName: string
  uid: string
  now: Now
}) {
  return {
    organization_id: params.organizationId,
    organization_name_snapshot: params.organizationName,
    active: true,
    created_by_uid: params.uid,
    created_at: params.now(),
  }
}

export function buildAdminSettingsDocument(params: {
  organizationId: string
  joinCode: string
  now: Now
}) {
  return {
    organization_id: params.organizationId,
    current_join_code_id: params.joinCode,
    updated_at: params.now(),
  }
}

export function buildJoinProofDocument(params: {
  organizationId: string
  uid: string
  joinCode: string
  now: Now
}) {
  return {
    organization_id: params.organizationId,
    uid: params.uid,
    join_code_id: params.joinCode,
    created_at: params.now(),
  }
}

export function buildTeamDocument(params: {
  teamId: string
  organizationId: string
  name: string
  description?: string | undefined
  now: Now
}) {
  const description = params.description?.trim()

  return {
    team_id: params.teamId,
    organization_id: params.organizationId,
    name: params.name,
    ...(description ? { description } : {}),
    created_at: params.now(),
    updated_at: params.now(),
  }
}
