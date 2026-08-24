import type { FieldValue, Timestamp } from 'firebase/firestore'
import type { CalendarVisibility } from '@/types/calendar'

/**
 * The exact calendar document shape written to Firestore.
 *
 * Security Rules validate it with `hasExactly`, so an extra or missing field is
 * a permission-denied rather than a soft failure. Keeping the shape here lets
 * the Rules tests exercise the payload the application actually sends.
 */
export type Now = () => FieldValue

export interface CalendarEventInput {
  title: string
  eventType: string
  /** Local midnight for the event's calendar date. */
  eventDate: Timestamp
  startTime?: string | undefined
  endTime?: string | undefined
  visibility: CalendarVisibility
  /** Display metadata, never a security boundary. */
  teamIds: string[]
  productionId?: string | null
  maintenanceId?: string | null
  notes?: string | undefined
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function editableFields(input: CalendarEventInput) {
  const startTime = optionalText(input.startTime)
  // An end time without a start time would be meaningless, and Rules reject it.
  const endTime = startTime ? optionalText(input.endTime) : undefined
  const notes = optionalText(input.notes)

  return {
    title: input.title.trim(),
    event_type: input.eventType.trim(),
    event_date: input.eventDate,
    ...(startTime ? { start_time: startTime } : {}),
    ...(endTime ? { end_time: endTime } : {}),
    visibility: input.visibility,
    team_ids: input.visibility === 'all_teams' ? [] : input.teamIds,
    ...(input.productionId ? { production_id: input.productionId } : {}),
    ...(input.maintenanceId ? { maintenance_id: input.maintenanceId } : {}),
    ...(notes ? { notes } : {}),
  }
}

export function buildCalendarEventDocument(params: {
  eventId: string
  organizationId: string
  uid: string
  now: Now
  input: CalendarEventInput
}) {
  return {
    event_id: params.eventId,
    organization_id: params.organizationId,
    ...editableFields(params.input),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

export function buildCalendarEventUpdate(params: {
  eventId: string
  organizationId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: CalendarEventInput
}) {
  return {
    event_id: params.eventId,
    organization_id: params.organizationId,
    ...editableFields(params.input),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}
