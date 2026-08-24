import { describe, expect, it } from 'vitest'
import { dateKeyToTimestamp } from '@/domain/calendar'
import {
  ALL_TEAMS_LABEL, EMPTY_CALENDAR_FILTERS, audienceLabel, eventsInMonth, filterCalendarEvents,
  groupEventsByDate, matchesTeamFilter, teamNamesOf, usedEventTypes,
} from '@/features/calendar/calendar-view'
import type { CalendarEvent } from '@/types/calendar'
import type { TheaterTeam } from '@/types/organization'

const teams = [
  { team_id: 't-lighting', name: 'Lighting' },
  { team_id: 't-costume', name: 'Costume' },
] as TheaterTeam[]

function event(o: {
  id?: string; title?: string; date?: string; start?: string
  visibility?: 'all_teams' | 'teams'; teamIds?: string[]; type?: string
} = {}): CalendarEvent {
  return {
    event_id: o.id ?? 'e-1',
    organization_id: 'org-1',
    title: o.title ?? 'Rehearsal',
    event_type: o.type ?? 'Rehearsal',
    event_date: dateKeyToTimestamp(o.date ?? '2026-08-24'),
    ...(o.start ? { start_time: o.start } : {}),
    visibility: o.visibility ?? 'all_teams',
    team_ids: o.teamIds ?? [],
    created_by_uid: 'u-1',
  } as unknown as CalendarEvent
}

describe('teamNamesOf and audienceLabel', () => {
  it('reports no teams for an all-teams event', () => {
    expect(teamNamesOf(event(), teams)).toEqual([])
    expect(audienceLabel(event(), teams)).toBe(ALL_TEAMS_LABEL)
  })

  it('names the tagged teams in the organization order', () => {
    const tagged = event({ visibility: 'teams', teamIds: ['t-costume', 't-lighting'] })
    expect(teamNamesOf(tagged, teams)).toEqual(['Lighting', 'Costume'])
    expect(audienceLabel(tagged, teams)).toBe('Lighting, Costume')
  })

  it('drops an unrecognized team ID rather than showing it', () => {
    // team_ids is display metadata, so a stale entry is noise, not an error.
    const tagged = event({ visibility: 'teams', teamIds: ['t-lighting', 't-gone'] })
    expect(teamNamesOf(tagged, teams)).toEqual(['Lighting'])
  })

  it('falls back to all teams when nothing resolves', () => {
    const tagged = event({ visibility: 'teams', teamIds: ['t-gone'] })
    expect(audienceLabel(tagged, teams)).toBe(ALL_TEAMS_LABEL)
  })
})

describe('matchesTeamFilter', () => {
  it('admits everything when no team is chosen', () => {
    expect(matchesTeamFilter(event(), 'all')).toBe(true)
  })

  it('admits an all-teams event under any team filter', () => {
    // It concerns every crew, so filtering to one must not hide it.
    expect(matchesTeamFilter(event(), 't-lighting')).toBe(true)
    expect(matchesTeamFilter(event(), 't-costume')).toBe(true)
  })

  it('admits a tagged event only for its teams', () => {
    const tagged = event({ visibility: 'teams', teamIds: ['t-lighting'] })
    expect(matchesTeamFilter(tagged, 't-lighting')).toBe(true)
    expect(matchesTeamFilter(tagged, 't-costume')).toBe(false)
  })
})

describe('filterCalendarEvents', () => {
  const events = [
    event({ id: 'e-1', type: 'Rehearsal' }),
    event({ id: 'e-2', type: 'Build Day', visibility: 'teams', teamIds: ['t-costume'] }),
    event({ id: 'e-3', type: 'Rehearsal', visibility: 'teams', teamIds: ['t-lighting'] }),
  ]

  it('returns everything with no filters', () => {
    expect(filterCalendarEvents(events, EMPTY_CALENDAR_FILTERS)).toHaveLength(3)
  })

  it('filters by team, keeping all-teams events', () => {
    const visible = filterCalendarEvents(events, { ...EMPTY_CALENDAR_FILTERS, teamId: 't-lighting' })
    expect(visible.map((e) => e.event_id)).toEqual(['e-1', 'e-3'])
  })

  it('filters by event type', () => {
    expect(filterCalendarEvents(events, { ...EMPTY_CALENDAR_FILTERS, eventType: 'Build Day' })).toHaveLength(1)
  })

  it('combines filters', () => {
    expect(
      filterCalendarEvents(events, { teamId: 't-lighting', eventType: 'Build Day' }),
    ).toHaveLength(0)
  })
})

describe('usedEventTypes', () => {
  it('lists the distinct types an organization has used, sorted', () => {
    const events = [event({ type: 'Rehearsal' }), event({ type: 'Build Day' }), event({ type: 'Rehearsal' })]
    expect(usedEventTypes(events)).toEqual(['Build Day', 'Rehearsal'])
  })

  it('is empty with no events', () => {
    expect(usedEventTypes([])).toEqual([])
  })
})

describe('groupEventsByDate', () => {
  it('keys events by their local date', () => {
    const grouped = groupEventsByDate([
      event({ id: 'e-1', date: '2026-08-24' }),
      event({ id: 'e-2', date: '2026-08-25' }),
      event({ id: 'e-3', date: '2026-08-24', start: '19:00' }),
    ])

    expect([...grouped.keys()].sort()).toEqual(['2026-08-24', '2026-08-25'])
    expect(grouped.get('2026-08-24')).toHaveLength(2)
  })

  it('orders each day with all-day events first', () => {
    const grouped = groupEventsByDate([
      event({ id: 'timed', date: '2026-08-24', start: '19:00' }),
      event({ id: 'allday', date: '2026-08-24' }),
    ])
    expect(grouped.get('2026-08-24')!.map((e) => e.event_id)).toEqual(['allday', 'timed'])
  })

  it('is empty with no events', () => {
    expect(groupEventsByDate([]).size).toBe(0)
  })
})

describe('eventsInMonth', () => {
  const events = [
    event({ id: 'aug', date: '2026-08-24' }),
    event({ id: 'sep', date: '2026-09-01' }),
    event({ id: 'lastAug', date: '2026-08-31' }),
  ]

  it('returns only that month, ordered', () => {
    expect(eventsInMonth(events, 2026, 7).map((e) => e.event_id).sort()).toEqual(['aug', 'lastAug'])
  })

  it('is empty for a month with nothing', () => {
    expect(eventsInMonth(events, 2026, 5)).toEqual([])
  })
})
