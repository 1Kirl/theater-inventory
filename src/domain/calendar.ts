import { Timestamp } from 'firebase/firestore'
import type { CalendarEvent, CalendarVisibility } from '@/types/calendar'

/**
 * Calendar dates and ordering.
 *
 * `event_date` is a local calendar date stored at local midnight. Every
 * conversion here goes through local date parts rather than ISO strings, so a
 * timezone offset can never shift an event onto the previous day.
 */

const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/** 'YYYY-MM-DD' from local parts. Not `toISOString`, which converts to UTC. */
export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dateKeyOf(event: Pick<CalendarEvent, 'event_date'>): string {
  return toDateKey(event.event_date.toDate())
}

/** Local midnight for a 'YYYY-MM-DD' key. */
export function dateKeyToDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

export function dateKeyToTimestamp(key: string): Timestamp {
  return Timestamp.fromDate(dateKeyToDate(key))
}

export function isAllDay(event: Pick<CalendarEvent, 'start_time'>): boolean {
  return !event.start_time
}

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value)
}

export type TimeValidation = { valid: true } | { valid: false; message: string }

/**
 * An event with no start time is all-day. An end time requires a start time and
 * must not precede it.
 */
export function validateEventTimes(params: {
  startTime?: string | undefined
  endTime?: string | undefined
}): TimeValidation {
  const start = params.startTime?.trim() ?? ''
  const end = params.endTime?.trim() ?? ''

  if (start.length === 0 && end.length === 0) return { valid: true }

  if (start.length === 0) {
    return { valid: false, message: 'An end time needs a start time. Leave both empty for an all-day event.' }
  }

  if (!isValidTime(start)) {
    return { valid: false, message: 'Start time must be a time of day, such as 19:30.' }
  }

  if (end.length === 0) return { valid: true }

  if (!isValidTime(end)) {
    return { valid: false, message: 'End time must be a time of day, such as 21:00.' }
  }

  if (end < start) {
    return { valid: false, message: 'End time cannot be before the start time.' }
  }

  return { valid: true }
}

export type VisibilityValidation = { valid: true } | { valid: false; message: string }

export function validateVisibility(params: {
  visibility: CalendarVisibility
  teamIds: readonly string[]
}): VisibilityValidation {
  if (params.visibility === 'teams' && params.teamIds.length === 0) {
    return { valid: false, message: 'Choose at least one team, or address the event to all teams.' }
  }

  if (params.visibility === 'all_teams' && params.teamIds.length > 0) {
    return { valid: false, message: 'An event for all teams cannot also name specific teams.' }
  }

  return { valid: true }
}

/**
 * Chronological: by date, then all-day first, then start time, then title.
 *
 * The date comparison is the whole reason this function is not just the
 * within-a-day rule. It was, once, and every caller that sorted across more
 * than one day was silently wrong: the dashboard's upcoming list and the
 * calendar's month agenda ordered events by time of day regardless of which day
 * they fell on, so a 9am event three weeks out sorted above a 2pm event
 * tomorrow. `eventsOnDate` hid the bug, because pre-filtering to one date makes
 * the missing comparison a tie.
 *
 * Compared as local date keys rather than raw timestamps, for the same reason
 * every other date decision in this file is: a stored `event_date` is a day, and
 * comparing instants would let a timezone move an event to the day before.
 *
 * Within a day, all-day comes first because it applies to the whole day rather
 * than a slot within it, so it reads as a heading for the others. `event_id` is
 * the final tie-breaker so that two events sharing a date, a time, and a title
 * still have one stable order rather than one that depends on arrival.
 */
export function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  const leftDate = dateKeyOf(left)
  const rightDate = dateKeyOf(right)
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1

  const leftAllDay = isAllDay(left)
  const rightAllDay = isAllDay(right)

  if (leftAllDay !== rightAllDay) return leftAllDay ? -1 : 1
  if (!leftAllDay && left.start_time !== right.start_time) {
    return (left.start_time ?? '').localeCompare(right.start_time ?? '')
  }

  if (left.title !== right.title) return left.title.localeCompare(right.title)

  return left.event_id.localeCompare(right.event_id)
}

export function sortEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(compareEvents)
}

/** Events on one local date, ordered. */
export function eventsOnDate(
  events: readonly CalendarEvent[],
  dateKey: string,
): CalendarEvent[] {
  return sortEvents(events.filter((event) => dateKeyOf(event) === dateKey))
}

export function isInMonth(event: Pick<CalendarEvent, 'event_date'>, year: number, month: number): boolean {
  const date = event.event_date.toDate()
  return date.getFullYear() === year && date.getMonth() === month
}

/**
 * Six weeks of dates covering the month, starting on Sunday, so the grid never
 * changes height between months.
 */
export function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1)
  const start = new Date(year, month, 1 - firstOfMonth.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const shifted = new Date(year, month + delta, 1)
  return { year: shifted.getFullYear(), month: shifted.getMonth() }
}

export function formatEventTime(event: Pick<CalendarEvent, 'start_time' | 'end_time'>): string {
  if (!event.start_time) return 'All day'
  return event.end_time ? `${event.start_time}–${event.end_time}` : event.start_time
}
