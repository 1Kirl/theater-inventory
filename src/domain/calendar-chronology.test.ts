import { describe, expect, it } from 'vitest'
import { compareEvents, dateKeyToTimestamp, sortEvents } from '@/domain/calendar'
import { summarizeCalendar, upcomingEvents } from '@/features/dashboard/dashboard-summary'
import { eventsInMonth, groupEventsByDate } from '@/features/calendar/calendar-view'
import type { CalendarEvent } from '@/types/calendar'

/**
 * The dashboard showed upcoming events in the wrong order and dropped one.
 *
 * `compareEvents` ordered by all-day, then start time, then title, and never
 * looked at the date. That is the correct rule *within* one day, which is why
 * `eventsOnDate` was right and hid the defect for so long — pre-filtering to a
 * single date turns the missing comparison into a tie.
 *
 * Every caller that sorted across more than one day was wrong: a 9am event three
 * weeks away sorted above a 2pm event tomorrow. And because the dashboard slices
 * the sorted list to five, the wrong order also decided which event vanished —
 * so a genuinely imminent event could be the one dropped.
 *
 * The six events below are the user's reported scenario. Their chronological
 * order is A B C D E F; the old comparator produced C F E B A D, and the slice
 * to five then discarded D.
 */

function event(o: {
  id: string
  title: string
  date: string
  start?: string
}): CalendarEvent {
  return {
    event_id: o.id,
    organization_id: 'org-1',
    title: o.title,
    event_type: 'Rehearsal',
    event_date: dateKeyToTimestamp(o.date),
    ...(o.start ? { start_time: o.start } : {}),
    visibility: 'all_teams',
    team_ids: [],
    created_by_uid: 'u-1',
  } as unknown as CalendarEvent
}

/**
 * Chosen so the old rule and the new one disagree about every position, rather
 * than happening to agree and proving nothing: the all-day events sit in the
 * middle and at the end, and the times deliberately run counter to the dates.
 */
const A = event({ id: 'ev-a', title: 'A', date: '2026-09-02', start: '14:00' })
const B = event({ id: 'ev-b', title: 'B', date: '2026-09-03', start: '09:00' })
const C = event({ id: 'ev-c', title: 'C', date: '2026-09-04' })
const D = event({ id: 'ev-d', title: 'D', date: '2026-09-05', start: '18:00' })
const E = event({ id: 'ev-e', title: 'E', date: '2026-09-06', start: '08:00' })
const F = event({ id: 'ev-f', title: 'F', date: '2026-09-07' })

/** Deliberately not in chronological order, the way Firestore returns them. */
const SHUFFLED = [E, B, F, A, C, D]
const TODAY = new Date(2026, 8, 1)

const titles = (events: readonly CalendarEvent[]) => events.map((e) => e.title)

describe('the reported six-event scenario', () => {
  it('sorts A B C D E F chronologically, whatever order they arrive in', () => {
    expect(titles(sortEvents(SHUFFLED))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('lists all six as upcoming, none dropped by the filter', () => {
    expect(titles(upcomingEvents(SHUFFLED, TODAY))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('previews the five earliest, so D is shown and only F is held back', () => {
    const summary = summarizeCalendar(SHUFFLED, TODAY)

    expect(titles(summary.preview)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(summary.preview).not.toContain(F)
  })

  it('counts all six even though it previews five', () => {
    expect(summarizeCalendar(SHUFFLED, TODAY).upcomingCount).toBe(6)
  })

  it('never drops an event that is earlier than one it shows', () => {
    const summary = summarizeCalendar(SHUFFLED, TODAY)
    const shown = new Set(summary.preview.map((e) => e.event_id))
    const withheld = upcomingEvents(SHUFFLED, TODAY).filter((e) => !shown.has(e.event_id))

    for (const hidden of withheld) {
      for (const visible of summary.preview) {
        expect(compareEvents(visible, hidden)).toBeLessThan(0)
      }
    }
  })
})

describe('ordering rules', () => {
  it('puts an earlier date first even when its time is later in the day', () => {
    const early = event({ id: 'x', title: 'Late in the day, but sooner', date: '2026-09-02', start: '23:00' })
    const later = event({ id: 'y', title: 'Early in the day, but weeks away', date: '2026-09-30', start: '06:00' })

    expect(titles(sortEvents([later, early]))).toEqual([early.title, later.title])
  })

  it('puts an earlier date first even when the later date is all-day', () => {
    const timed = event({ id: 'x', title: 'Timed, sooner', date: '2026-09-02', start: '19:00' })
    const allDay = event({ id: 'y', title: 'All-day, later', date: '2026-09-09' })

    expect(titles(sortEvents([allDay, timed]))).toEqual([timed.title, allDay.title])
  })

  it('still puts all-day first among events on the same day', () => {
    const timed = event({ id: 'x', title: 'Timed', date: '2026-09-02', start: '09:00' })
    const allDay = event({ id: 'y', title: 'All-day', date: '2026-09-02' })

    expect(titles(sortEvents([timed, allDay]))).toEqual(['All-day', 'Timed'])
  })

  it('orders same-day timed events by start time', () => {
    const evening = event({ id: 'x', title: 'Evening', date: '2026-09-02', start: '19:00' })
    const morning = event({ id: 'y', title: 'Morning', date: '2026-09-02', start: '09:00' })

    expect(titles(sortEvents([evening, morning]))).toEqual(['Morning', 'Evening'])
  })

  it('falls back to title when date and time match', () => {
    const second = event({ id: 'x', title: 'Sound check', date: '2026-09-02', start: '09:00' })
    const first = event({ id: 'y', title: 'Load in', date: '2026-09-02', start: '09:00' })

    expect(titles(sortEvents([second, first]))).toEqual(['Load in', 'Sound check'])
  })

  it('is deterministic when date, time, and title all match', () => {
    const later = event({ id: 'ev-2', title: 'Same', date: '2026-09-02', start: '09:00' })
    const earlier = event({ id: 'ev-1', title: 'Same', date: '2026-09-02', start: '09:00' })

    expect(sortEvents([later, earlier]).map((e) => e.event_id)).toEqual(['ev-1', 'ev-2'])
    expect(sortEvents([earlier, later]).map((e) => e.event_id)).toEqual(['ev-1', 'ev-2'])
  })
})

describe('which events are upcoming', () => {
  it('includes an event today, whatever time of day it is', () => {
    const todayAllDay = event({ id: 'x', title: 'Today all-day', date: '2026-09-01' })
    const todayEarly = event({ id: 'y', title: 'Today 06:00', date: '2026-09-01', start: '06:00' })

    expect(titles(upcomingEvents([todayAllDay, todayEarly], TODAY)))
      .toEqual(['Today all-day', 'Today 06:00'])
  })

  // The filter compares local date keys, so "today" means the whole local day
  // rather than the moment the dashboard happened to load.
  it('includes an event today even when the dashboard loads late in the evening', () => {
    const lateLoad = new Date(2026, 8, 1, 23, 45)
    const todayMorning = event({ id: 'x', title: 'Today 08:00', date: '2026-09-01', start: '08:00' })

    expect(titles(upcomingEvents([todayMorning], lateLoad))).toEqual(['Today 08:00'])
  })

  it('excludes yesterday and keeps everything from today onward', () => {
    const yesterday = event({ id: 'x', title: 'Yesterday', date: '2026-08-31' })

    expect(titles(upcomingEvents([yesterday, ...SHUFFLED], TODAY)))
      .toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('reports nothing rather than something arbitrary when everything is past', () => {
    const past = event({ id: 'x', title: 'Past', date: '2026-01-01' })
    const summary = summarizeCalendar([past], TODAY)

    expect(summary.upcomingCount).toBe(0)
    expect(summary.preview).toEqual([])
  })
})

/**
 * The dashboard was not the only caller sorting across days. Fixing the
 * comparator fixed these too, and they are pinned here so a future change
 * cannot quietly re-narrow the rule to within-a-day.
 */
describe('the other cross-day callers', () => {
  it('orders a month agenda chronologically', () => {
    expect(titles(eventsInMonth(SHUFFLED, 2026, 8))).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('builds date buckets in chronological order', () => {
    expect([...groupEventsByDate(SHUFFLED).keys()]).toEqual([
      '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07',
    ])
  })
})
