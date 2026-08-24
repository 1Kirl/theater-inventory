import type { FieldValue, Timestamp } from 'firebase/firestore'
import type { MaintenanceStatus, ReturnMethod } from '@/types/maintenance'

/**
 * The exact maintenance document shape written to Firestore.
 *
 * Security Rules validate it with `hasExactly`, so an extra or missing field is
 * a permission-denied rather than a soft failure. Keeping the shape here lets
 * the Rules tests exercise the payload the application actually sends.
 */
export type Now = () => FieldValue

export interface MaintenanceInput {
  quantitySent: number
  issueDescription: string
  status: MaintenanceStatus
  sentAt?: Timestamp | null
  returnMethod?: ReturnMethod | null
  expectedReturnAt?: Timestamp | null
  returnedAt?: Timestamp | null
  serviceProviderName?: string | undefined
  serviceProviderPhone?: string | undefined
  serviceProviderEmail?: string | undefined
  cost?: number | null
  repairNotes?: string | undefined
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

/** Fields the user may set. Identity, the item link, and the team are not among them. */
function editableFields(input: MaintenanceInput) {
  const providerName = optionalText(input.serviceProviderName)
  const providerPhone = optionalText(input.serviceProviderPhone)
  const providerEmail = optionalText(input.serviceProviderEmail)
  const repairNotes = optionalText(input.repairNotes)

  return {
    quantity_sent: input.quantitySent,
    issue_description: input.issueDescription.trim(),
    status: input.status,
    ...(input.sentAt ? { sent_at: input.sentAt } : {}),
    ...(input.returnMethod ? { return_method: input.returnMethod } : {}),
    ...(input.expectedReturnAt ? { expected_return_at: input.expectedReturnAt } : {}),
    ...(input.returnedAt ? { returned_at: input.returnedAt } : {}),
    ...(providerName ? { service_provider_name: providerName } : {}),
    ...(providerPhone ? { service_provider_phone: providerPhone } : {}),
    ...(providerEmail ? { service_provider_email: providerEmail } : {}),
    ...(typeof input.cost === 'number' ? { cost: input.cost } : {}),
    ...(repairNotes ? { repair_notes: repairNotes } : {}),
  }
}

export function buildMaintenanceDocument(params: {
  maintenanceId: string
  organizationId: string
  itemId: string
  /** Copied from the linked item; a historical snapshot, immutable afterwards. */
  teamId: string
  uid: string
  now: Now
  input: MaintenanceInput
}) {
  return {
    maintenance_id: params.maintenanceId,
    organization_id: params.organizationId,
    item_id: params.itemId,
    team_id: params.teamId,
    ...editableFields(params.input),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

/**
 * An update replaces the whole document rather than merging, so a field the user
 * cleared is actually removed. Identity, the item link, the team snapshot, and
 * authorship carry through unchanged and are immutable in Rules.
 */
export function buildMaintenanceUpdate(params: {
  maintenanceId: string
  organizationId: string
  itemId: string
  teamId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: MaintenanceInput
}) {
  return {
    maintenance_id: params.maintenanceId,
    organization_id: params.organizationId,
    item_id: params.itemId,
    team_id: params.teamId,
    ...editableFields(params.input),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}
