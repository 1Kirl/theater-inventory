import type { Timestamp } from 'firebase/firestore'

export const CALENDAR_VISIBILITIES = ['all_teams', 'teams'] as const
export type CalendarVisibility = (typeof CALENDAR_VISIBILITIES)[number]

/**
 * Suggestions, not a closed set. DATA_MODEL defines `event_type` as free text
 * and IA lists these as examples, so the form offers them and the filter is
 * built from what an organization has actually used.
 */
export const EVENT_TYPE_SUGGESTIONS = [
  'Rehearsal',
  'Build Day',
  'Equipment Inspection',
  'Repair Pickup/Return',
  'Production Deadline',
] as const

/**
 * Path: calendar_events/{eventId} — organization-level.
 *
 * `team_ids` is display metadata, never a security boundary. Date and time are
 * separate: an event with no `start_time` is all-day.
 */
export interface CalendarEvent {
  event_id: string
  organization_id: string
  title: string
  event_type: string
  /** Date-only, stored at local midnight. */
  event_date: Timestamp
  start_time?: string
  end_time?: string
  visibility: CalendarVisibility
  team_ids: string[]
  production_id?: string
  maintenance_id?: string
  notes?: string
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}
