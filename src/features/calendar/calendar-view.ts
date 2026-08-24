import { eventsOnDate, isInMonth, sortEvents, toDateKey } from '@/domain/calendar'
import type { CalendarEvent } from '@/types/calendar'
import type { TheaterTeam } from '@/types/organization'

/** Presentation helpers, pure so the grid and the day panel agree. */

export const ALL_TEAMS_LABEL = 'All teams'

export function teamNamesOf(
  event: Pick<CalendarEvent, 'visibility' | 'team_ids'>,
  teams: readonly TheaterTeam[],
): string[] {
  if (event.visibility === 'all_teams') return []

  const tagged = new Set(event.team_ids)
  return teams.filter((team) => tagged.has(team.team_id)).map((team) => team.name)
}

/**
 * How the event's audience reads. An unrecognized team ID simply drops out:
 * `team_ids` is display metadata, so a stale entry is noise rather than an
 * error worth surfacing.
 */
export function audienceLabel(
  event: Pick<CalendarEvent, 'visibility' | 'team_ids'>,
  teams: readonly TheaterTeam[],
): string {
  if (event.visibility === 'all_teams') return ALL_TEAMS_LABEL

  const names = teamNamesOf(event, teams)
  return names.length > 0 ? names.join(', ') : ALL_TEAMS_LABEL
}

/**
 * Whether a team filter admits this event.
 *
 * An all-teams event concerns every crew, so it survives any team filter. This
 * is a display filter only; Security Rules never read `team_ids`.
 */
export function matchesTeamFilter(
  event: Pick<CalendarEvent, 'visibility' | 'team_ids'>,
  teamId: string,
): boolean {
  if (teamId === 'all') return true
  if (event.visibility === 'all_teams') return true
  return event.team_ids.includes(teamId)
}

export interface CalendarFilters {
  teamId: string
  eventType: string
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = { teamId: 'all', eventType: 'all' }

export function filterCalendarEvents(
  events: readonly CalendarEvent[],
  filters: CalendarFilters,
): CalendarEvent[] {
  return events.filter((event) => {
    if (!matchesTeamFilter(event, filters.teamId)) return false
    if (filters.eventType !== 'all' && event.event_type !== filters.eventType) return false
    return true
  })
}

/** Event types an organization has actually used, for the filter. */
export function usedEventTypes(events: readonly CalendarEvent[]): string[] {
  return [...new Set(events.map((event) => event.event_type))].sort((left, right) =>
    left.localeCompare(right),
  )
}

/** Events for one month, keyed by local date, each list ordered. */
export function groupEventsByDate(
  events: readonly CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const grouped = new Map<string, CalendarEvent[]>()

  for (const event of sortEvents(events)) {
    const key = toDateKey(event.event_date.toDate())
    const existing = grouped.get(key)
    if (existing) {
      existing.push(event)
    } else {
      grouped.set(key, [event])
    }
  }

  return grouped
}

export function eventsInMonth(
  events: readonly CalendarEvent[],
  year: number,
  month: number,
): CalendarEvent[] {
  return sortEvents(events.filter((event) => isInMonth(event, year, month)))
}

export { eventsOnDate }
