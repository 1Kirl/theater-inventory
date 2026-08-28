import { describe, expect, it } from 'vitest'
import {
  eventDetail, eventLabel, lifecycleActions, noActionsReason, retirementLabel,
} from '@/features/inventory/unit-lifecycle-view'
import { canTransition } from '@/domain/inventory'
import { ASSET_EVENT_TYPES } from '@/types/asset-event'
import { UNIT_STATUSES, type UnitStatus } from '@/types/inventory'

const teamName = (teamId: string) => (teamId === 'team-lighting' ? 'Lighting' : 'Scenic')

describe('which actions a unit offers', () => {
  it('offers taking out, losing, and retiring an available unit', () => {
    expect(lifecycleActions({ status: 'available' }).map((one) => one.label))
      .toEqual(['Mark as In Use', 'Mark Lost', 'Retire'])
  })

  it('offers checking in and losing a unit that is out', () => {
    expect(lifecycleActions({ status: 'in_use' }).map((one) => one.label))
      .toEqual(['Check In', 'Mark Lost'])
  })

  it('does not offer retiring a unit that is out', () => {
    // Get it back or report it lost first.
    expect(lifecycleActions({ status: 'in_use' }).map((one) => one.to)).not.toContain('retired')
  })

  it('offers finding and retiring a lost unit', () => {
    expect(lifecycleActions({ status: 'lost' }).map((one) => one.label))
      .toEqual(['Mark as Found', 'Retire'])
  })

  it('offers nothing for a unit in maintenance, and says why', () => {
    expect(lifecycleActions({ status: 'in_maintenance' })).toEqual([])
    expect(noActionsReason({ status: 'in_maintenance' })).toContain('maintenance record')
  })

  it('offers nothing for a retired unit, and says why', () => {
    expect(lifecycleActions({ status: 'retired' })).toEqual([])
    expect(noActionsReason({ status: 'retired' })).toContain('retired')
  })

  it('says nothing extra when there are actions to take', () => {
    expect(noActionsReason({ status: 'available' })).toBeNull()
  })

  it('never offers a button for a move the model forbids', () => {
    // The buttons come from the domain's offered transitions, so a button that
    // the service would refuse cannot appear.
    for (const status of UNIT_STATUSES) {
      for (const action of lifecycleActions({ status })) {
        expect(canTransition(status, action.to), `${status} → ${action.to}`).toBe(true)
      }
    }
  })

  it('gives every action a label rather than a raw status', () => {
    for (const status of UNIT_STATUSES) {
      for (const action of lifecycleActions({ status })) {
        expect(action.label).not.toContain('_')
      }
    }
  })

  it('gives the irreversible actions the quieter treatment', () => {
    const actions = lifecycleActions({ status: 'available' })
    expect(actions.find((one) => one.to === 'in_use')?.tone).toBe('default')
    expect(actions.find((one) => one.to === 'lost')?.tone).toBe('outline')
    expect(actions.find((one) => one.to === 'retired')?.tone).toBe('outline')
  })
})

describe('how history reads', () => {
  it('labels every event type in plain words', () => {
    for (const type of ASSET_EVENT_TYPES) {
      const label = eventLabel({ event_type: type })
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('_')
    }
  })

  it('names who is taking equipment out', () => {
    expect(eventDetail(
      { event_type: 'marked_in_use', using_team_id: 'team-lighting' },
      teamName,
    )).toBe('Using team: Lighting')
  })

  it('names who had it when it comes back', () => {
    expect(eventDetail(
      { event_type: 'checked_in', using_team_id: 'team-lighting' },
      teamName,
    )).toBe('Previously used by: Lighting')
  })

  it('answers who had it when it went missing', () => {
    // The question this log exists to answer, after the unit stopped saying so.
    expect(eventDetail(
      { event_type: 'marked_lost', using_team_id: 'team-scenic' },
      teamName,
    )).toBe('Previously used by: Scenic')
  })

  it('gives the reason on a retirement', () => {
    expect(eventDetail(
      { event_type: 'retired', retirement_reason: 'donated' },
      teamName,
    )).toBe('Reason: Donated')
  })

  it('says nothing extra when there is nothing to add', () => {
    expect(eventDetail({ event_type: 'marked_found' }, teamName)).toBeNull()
    expect(eventDetail({ event_type: 'retired' }, teamName)).toBeNull()
  })

  it('survives a team that no longer exists', () => {
    expect(eventDetail(
      { event_type: 'marked_lost', using_team_id: 'team-gone' },
      () => 'a team that no longer exists',
    )).toBe('Previously used by: a team that no longer exists')
  })

  it('labels every retirement reason readably', () => {
    for (const reason of ['disposed', 'permanently_lost', 'donated', 'sold', 'other']) {
      expect(retirementLabel(reason)).not.toContain('_')
    }
  })

  it('falls back to the raw value rather than showing nothing', () => {
    expect(retirementLabel('something-new')).toBe('something-new')
  })
})

describe('action labels match what the action does', () => {
  it.each([
    ['available', 'in_use', 'Mark as In Use'],
    ['available', 'lost', 'Mark Lost'],
    ['available', 'retired', 'Retire'],
    ['in_use', 'available', 'Check In'],
    ['lost', 'available', 'Mark as Found'],
  ] as [UnitStatus, UnitStatus, string][])('%s → %s reads "%s"', (from, to, label) => {
    expect(lifecycleActions({ status: from }).find((one) => one.to === to)?.label).toBe(label)
  })
})
