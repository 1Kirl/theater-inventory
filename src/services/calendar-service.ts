import {
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildCalendarEventDocument, buildCalendarEventUpdate, type CalendarEventInput,
} from '@/domain/calendar-payloads'
import { validateEventTimes, validateVisibility } from '@/domain/calendar'
import type { CalendarEvent } from '@/types/calendar'

const MAX_TITLE_LENGTH = 120
const MAX_TYPE_LENGTH = 60
const MAX_NOTES_LENGTH = 2000
const MAX_TEAMS = 30

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
}

function validate(input: CalendarEventInput): void {
  const title = input.title.trim()
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new OrganizationError(
      'invalid-calendar-event',
      `Event title must be between 1 and ${MAX_TITLE_LENGTH} characters.`,
    )
  }

  const eventType = input.eventType.trim()
  if (eventType.length === 0 || eventType.length > MAX_TYPE_LENGTH) {
    throw new OrganizationError(
      'invalid-calendar-event',
      `Event type must be between 1 and ${MAX_TYPE_LENGTH} characters.`,
    )
  }

  if (input.teamIds.length > MAX_TEAMS) {
    throw new OrganizationError('invalid-calendar-event', 'Too many teams selected.')
  }

  if ((input.notes?.trim().length ?? 0) > MAX_NOTES_LENGTH) {
    throw new OrganizationError(
      'invalid-calendar-event',
      `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
    )
  }

  const times = validateEventTimes({ startTime: input.startTime, endTime: input.endTime })
  if (!times.valid) throw new OrganizationError('invalid-calendar-event', times.message)

  const visibility = validateVisibility({ visibility: input.visibility, teamIds: input.teamIds })
  if (!visibility.valid) throw new OrganizationError('invalid-calendar-event', visibility.message)
}

/**
 * Every event in the organization.
 *
 * One equality filter, and the month is selected client-side. A date-range query
 * would need a composite index and gain nothing at a school theater's volume,
 * where a season's events number in the dozens.
 */
export async function listCalendarEvents(organizationId: string): Promise<CalendarEvent[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.calendarEvents),
      where('organization_id', '==', organizationId),
    ),
  )
  return snapshot.docs.map((entry) => entry.data() as CalendarEvent)
}

export async function getCalendarEvent(eventId: string): Promise<CalendarEvent | null> {
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.calendarEvents, eventId))
  return snapshot.exists() ? (snapshot.data() as CalendarEvent) : null
}

export async function createCalendarEvent(params: {
  organizationId: string
  input: CalendarEventInput
}): Promise<{ eventId: string }> {
  const uid = requireUid()
  validate(params.input)

  const db = getFirebaseDb()
  const ref = doc(collection(db, COLLECTIONS.calendarEvents))

  await setDoc(
    ref,
    buildCalendarEventDocument({
      eventId: ref.id,
      organizationId: params.organizationId,
      uid,
      now: serverTimestamp,
      input: params.input,
    }),
  )

  return { eventId: ref.id }
}

export async function updateCalendarEvent(params: {
  existing: CalendarEvent
  input: CalendarEventInput
}): Promise<void> {
  requireUid()
  validate(params.input)

  await setDoc(
    doc(getFirebaseDb(), COLLECTIONS.calendarEvents, params.existing.event_id),
    buildCalendarEventUpdate({
      eventId: params.existing.event_id,
      organizationId: params.existing.organization_id,
      createdByUid: params.existing.created_by_uid,
      createdAt: params.existing.created_at,
      now: serverTimestamp,
      input: params.input,
    }),
  )
}

/**
 * Calendar is the only collection in the MVP where deletion is allowed, stated
 * directly in IA section 9.2. A cancelled rehearsal is not history worth keeping
 * the way a repair record or an action item is.
 */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  requireUid()
  await deleteDoc(doc(getFirebaseDb(), COLLECTIONS.calendarEvents, eventId))
}
