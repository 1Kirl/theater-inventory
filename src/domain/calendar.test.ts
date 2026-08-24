import { describe, expect, it } from 'vitest'
import {
  addMonths, buildMonthGrid, compareEvents, dateKeyOf, dateKeyToDate, dateKeyToTimestamp,
  eventsOnDate, formatEventTime, isAllDay, isInMonth, isValidTime, sortEvents, toDateKey,
  validateEventTimes, validateVisibility,
} from '@/domain/calendar'
import {
  buildCalendarEventDocument, buildCalendarEventUpdate, type CalendarEventInput,
} from '@/domain/calendar-payloads'
import type { CalendarEvent } from '@/types/calendar'
import type { FieldValue, Timestamp } from 'firebase/firestore'

function event(o: { title?: string; date?: string; start?: string; end?: string } = {}): CalendarEvent {
  return {
    event_id: 'e-1',
    organization_id: 'org-1',
    title: o.title ?? 'Rehearsal',
    event_type: 'Rehearsal',
    event_date: dateKeyToTimestamp(o.date ?? '2026-08-24'),
    ...(o.start ? { start_time: o.start } : {}),
    ...(o.end ? { end_time: o.end } : {}),
    visibility: 'all_teams',
    team_ids: [],
    created_by_uid: 'u-1',
  } as unknown as CalendarEvent
}

describe('local date handling', () => {
  it('builds a key from local parts, not UTC', () => {
    // Late-evening local time is the next day in UTC. Using toISOString here
    // would move the event a day, which is the bug this avoids.
    expect(toDateKey(new Date(2026, 7, 24, 23, 30))).toBe('2026-08-24')
    expect(toDateKey(new Date(2026, 7, 24, 0, 15))).toBe('2026-08-24')
  })

  it('pads months and days', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('round-trips a key through a Timestamp unchanged', () => {
    for (const key of ['2026-01-01', '2026-08-24', '2026-12-31']) {
      expect(dateKeyOf({ event_date: dateKeyToTimestamp(key) })).toBe(key)
    }
  })

  it('resolves a key to local midnight', () => {
    const date = dateKeyToDate('2026-08-24')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(7)
    expect(date.getDate()).toBe(24)
    expect(date.getHours()).toBe(0)
  })
})

describe('isAllDay and formatEventTime', () => {
  it('treats a missing start time as all day', () => {
    expect(isAllDay(event())).toBe(true)
    expect(formatEventTime(event())).toBe('All day')
  })

  it('treats a start time as a timed event', () => {
    expect(isAllDay(event({ start: '19:30' }))).toBe(false)
    expect(formatEventTime(event({ start: '19:30' }))).toBe('19:30')
  })

  it('shows a range when both times are set', () => {
    expect(formatEventTime(event({ start: '19:30', end: '21:00' }))).toBe('19:30–21:00')
  })
})

describe('isValidTime', () => {
  it('accepts a 24-hour time', () => {
    for (const value of ['00:00', '09:05', '19:30', '23:59']) {
      expect(isValidTime(value), value).toBe(true)
    }
  })

  it('rejects anything else', () => {
    for (const value of ['24:00', '7:30', '19:60', '19h30', '', '1930']) {
      expect(isValidTime(value), value).toBe(false)
    }
  })
})

describe('validateEventTimes', () => {
  it('accepts an all-day event with no times', () => {
    expect(validateEventTimes({}).valid).toBe(true)
  })

  it('accepts a start time on its own', () => {
    expect(validateEventTimes({ startTime: '19:30' }).valid).toBe(true)
  })

  it('accepts a start and end together', () => {
    expect(validateEventTimes({ startTime: '19:30', endTime: '21:00' }).valid).toBe(true)
  })

  it('accepts an end equal to the start', () => {
    expect(validateEventTimes({ startTime: '19:30', endTime: '19:30' }).valid).toBe(true)
  })

  it('rejects an end time with no start time', () => {
    const result = validateEventTimes({ endTime: '21:00' })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('all-day')
  })

  it('rejects an end before the start', () => {
    const result = validateEventTimes({ startTime: '21:00', endTime: '19:30' })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('before')
  })

  it('rejects malformed times', () => {
    expect(validateEventTimes({ startTime: '7pm' }).valid).toBe(false)
    expect(validateEventTimes({ startTime: '19:30', endTime: '25:00' }).valid).toBe(false)
  })
})

describe('validateVisibility', () => {
  it('accepts all teams with no team list', () => {
    expect(validateVisibility({ visibility: 'all_teams', teamIds: [] }).valid).toBe(true)
  })

  it('accepts specific teams with at least one', () => {
    expect(validateVisibility({ visibility: 'teams', teamIds: ['t-1'] }).valid).toBe(true)
  })

  it('rejects specific teams with none chosen', () => {
    expect(validateVisibility({ visibility: 'teams', teamIds: [] }).valid).toBe(false)
  })

  it('rejects all teams carrying a team list', () => {
    expect(validateVisibility({ visibility: 'all_teams', teamIds: ['t-1'] }).valid).toBe(false)
  })
})

describe('ordering', () => {
  it('puts all-day events before timed ones', () => {
    expect(compareEvents(event(), event({ start: '09:00' }))).toBeLessThan(0)
    expect(compareEvents(event({ start: '09:00' }), event())).toBeGreaterThan(0)
  })

  it('orders timed events by start time', () => {
    const sorted = sortEvents([
      event({ title: 'Late', start: '19:30' }),
      event({ title: 'Early', start: '09:00' }),
    ])
    expect(sorted.map((e) => e.title)).toEqual(['Early', 'Late'])
  })

  it('falls back to title for events at the same time', () => {
    const sorted = sortEvents([
      event({ title: 'Sound check', start: '18:00' }),
      event({ title: 'Fight call', start: '18:00' }),
    ])
    expect(sorted.map((e) => e.title)).toEqual(['Fight call', 'Sound check'])
  })

  it('orders a mixed day predictably', () => {
    const sorted = sortEvents([
      event({ title: 'Evening', start: '19:00' }),
      event({ title: 'Build day' }),
      event({ title: 'Matinee', start: '14:00' }),
    ])
    expect(sorted.map((e) => e.title)).toEqual(['Build day', 'Matinee', 'Evening'])
  })

  it('does not mutate the input', () => {
    const input = [event({ title: 'B', start: '19:00' }), event({ title: 'A', start: '09:00' })]
    sortEvents(input)
    expect(input[0]!.title).toBe('B')
  })
})

describe('eventsOnDate', () => {
  const events = [
    event({ title: 'Rehearsal', date: '2026-08-24', start: '19:00' }),
    event({ title: 'Build day', date: '2026-08-24' }),
    event({ title: 'Other day', date: '2026-08-25' }),
  ]

  it('returns only that date, ordered', () => {
    expect(eventsOnDate(events, '2026-08-24').map((e) => e.title)).toEqual(['Build day', 'Rehearsal'])
  })

  it('returns nothing for an empty date', () => {
    expect(eventsOnDate(events, '2026-08-26')).toEqual([])
  })
})

describe('isInMonth', () => {
  it('matches the year and month', () => {
    expect(isInMonth({ event_date: dateKeyToTimestamp('2026-08-24') }, 2026, 7)).toBe(true)
  })

  it('rejects a neighbouring month or year', () => {
    expect(isInMonth({ event_date: dateKeyToTimestamp('2026-09-01') }, 2026, 7)).toBe(false)
    expect(isInMonth({ event_date: dateKeyToTimestamp('2025-08-24') }, 2026, 7)).toBe(false)
  })
})

describe('buildMonthGrid', () => {
  it('always returns six weeks, so the grid never changes height', () => {
    for (const [year, month] of [[2026, 0], [2026, 1], [2026, 7], [2026, 11]] as const) {
      expect(buildMonthGrid(year, month)).toHaveLength(42)
    }
  })

  it('starts on a Sunday', () => {
    expect(buildMonthGrid(2026, 7)[0]!.getDay()).toBe(0)
  })

  it('contains every day of the month', () => {
    const keys = buildMonthGrid(2026, 7).map(toDateKey)
    expect(keys).toContain('2026-08-01')
    expect(keys).toContain('2026-08-31')
  })

  it('runs consecutively with no gaps', () => {
    const grid = buildMonthGrid(2026, 7)
    for (let index = 1; index < grid.length; index += 1) {
      const gap = grid[index]!.getTime() - grid[index - 1]!.getTime()
      expect(Math.round(gap / 86_400_000)).toBe(1)
    }
  })
})

describe('addMonths', () => {
  it('moves forward and back', () => {
    expect(addMonths(2026, 7, 1)).toEqual({ year: 2026, month: 8 })
    expect(addMonths(2026, 7, -1)).toEqual({ year: 2026, month: 6 })
  })

  it('rolls over year boundaries', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('calendar event payloads', () => {
  const now = () => 'ts' as unknown as FieldValue
  const eventDate = { seconds: 1, nanoseconds: 0 } as unknown as Timestamp

  function input(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
    return {
      title: 'Tech Rehearsal',
      eventType: 'Rehearsal',
      eventDate,
      visibility: 'all_teams',
      teamIds: [],
      ...overrides,
    }
  }

  function document(overrides: Partial<CalendarEventInput> = {}) {
    return buildCalendarEventDocument({
      eventId: 'e-1',
      organizationId: 'org-1',
      uid: 'u-1',
      now,
      input: input(overrides),
    })
  }

  it('writes the minimum all-day shape and omits every empty optional', () => {
    // Rules validate the document with hasExactly, so an empty-string optional
    // would be a permission-denied rather than a blank field.
    expect(Object.keys(document()).sort()).toEqual([
      'created_at', 'created_by_uid', 'event_date', 'event_id', 'event_type',
      'organization_id', 'team_ids', 'title', 'updated_at', 'visibility',
    ])
  })

  it('trims the text fields', () => {
    const payload = document({ title: '  Build Day  ', eventType: '  Build Day  ', notes: '  bring drills  ' })
    expect(payload.title).toBe('Build Day')
    expect(payload.event_type).toBe('Build Day')
    expect(payload).toHaveProperty('notes', 'bring drills')
  })

  it('drops an end time that has no start time', () => {
    const payload = document({ endTime: '17:00' })
    expect(payload).not.toHaveProperty('start_time')
    expect(payload).not.toHaveProperty('end_time')
  })

  it('clears team_ids when the event is for all teams', () => {
    expect(document({ visibility: 'all_teams', teamIds: ['t-sound'] }).team_ids).toEqual([])
    expect(document({ visibility: 'teams', teamIds: ['t-sound'] }).team_ids).toEqual(['t-sound'])
  })

  it('includes the optional record links only when they are set', () => {
    const linked = document({ productionId: 'p-1', maintenanceId: 'm-1' })
    expect(linked).toHaveProperty('production_id', 'p-1')
    expect(linked).toHaveProperty('maintenance_id', 'm-1')

    const cleared = document({ productionId: null, maintenanceId: null })
    expect(cleared).not.toHaveProperty('production_id')
    expect(cleared).not.toHaveProperty('maintenance_id')
  })

  it('preserves the original author and creation time on update', () => {
    // Both fields are immutable in Rules, so an update that re-stamped them
    // would be denied outright.
    const createdAt = { seconds: 5, nanoseconds: 0 } as unknown as Timestamp
    const payload = buildCalendarEventUpdate({
      eventId: 'e-1',
      organizationId: 'org-1',
      createdByUid: 'u-author',
      createdAt,
      now,
      input: input({ title: 'Renamed' }),
    })

    expect(payload.created_by_uid).toBe('u-author')
    expect(payload.created_at).toBe(createdAt)
    expect(payload.event_id).toBe('e-1')
    expect(payload.title).toBe('Renamed')
  })
})
