import { describe, expect, it } from 'vitest'
import {
  eventDetail, eventLabel, lifecycleActions, lifecyclePanel, noActionsReason, retirementLabel,
  unitMaintenanceIndicator, unitRowControls,
} from '@/features/inventory/unit-lifecycle-view'
import { canTransition } from '@/domain/inventory'
import { ASSET_EVENT_TYPES } from '@/types/asset-event'
import { UNIT_STATUSES, type UnitStatus } from '@/types/inventory'
import type { OrganizationMembership } from '@/types/organization'

const teamName = (teamId: string) => (teamId === 'team-lighting' ? 'Lighting' : 'Scenic')

describe('which actions a unit offers', () => {
  it('offers taking out, losing, and retiring an available unit', () => {
    expect(lifecycleActions({ status: 'available', condition: 'good' }).map((one) => one.label))
      .toEqual(['Mark as In Use', 'Mark Lost', 'Retire'])
  })

  it('offers checking in and losing a unit that is out', () => {
    expect(lifecycleActions({ status: 'in_use', condition: 'good' }).map((one) => one.label))
      .toEqual(['Check In', 'Mark Lost'])
  })

  it('does not offer retiring a unit that is out', () => {
    // Get it back or report it lost first.
    expect(lifecycleActions({ status: 'in_use', condition: 'good' }).map((one) => one.to)).not.toContain('retired')
  })

  it('offers finding and retiring a lost unit', () => {
    expect(lifecycleActions({ status: 'lost', condition: 'good' }).map((one) => one.label))
      .toEqual(['Mark as Found', 'Retire'])
  })

  it('offers nothing for a unit in maintenance, and says why', () => {
    expect(lifecycleActions({ status: 'in_maintenance', condition: 'good' })).toEqual([])
    expect(noActionsReason({ status: 'in_maintenance', condition: 'good' }))
      .toContain('maintenance record')
  })

  it('does not offer taking out a unit that is unusable', () => {
    // It is on the shelf and not fit to use. The service refuses this move, so
    // a button for it would only appear in order to fail.
    const actions = lifecycleActions({ status: 'available', condition: 'unusable' })

    expect(actions.map((one) => one.to)).toEqual(['lost', 'retired'])
    expect(noActionsReason({ status: 'available', condition: 'unusable' }))
      .toContain('unusable')
  })

  it('still offers losing and retiring an unusable unit', () => {
    // Both genuinely happen to broken equipment.
    expect(lifecycleActions({ status: 'available', condition: 'unusable' }).map((one) => one.label))
      .toEqual(['Mark Lost', 'Retire'])
  })

  it('offers taking out a unit that merely needs repair', () => {
    expect(lifecycleActions({ status: 'available', condition: 'needs_repair' })
      .map((one) => one.to)).toContain('in_use')
  })

  it('offers nothing for a retired unit, and says why', () => {
    expect(lifecycleActions({ status: 'retired', condition: 'good' })).toEqual([])
    expect(noActionsReason({ status: 'retired', condition: 'good' })).toContain('retired')
  })

  it('says nothing extra when there are actions to take', () => {
    expect(noActionsReason({ status: 'available', condition: 'good' })).toBeNull()
  })

  it('never offers a button for a move the model forbids', () => {
    // The buttons come from the domain's offered transitions, so a button that
    // the service would refuse cannot appear.
    for (const status of UNIT_STATUSES) {
      for (const action of lifecycleActions({ status, condition: 'good' })) {
        expect(canTransition(status, action.to), `${status} → ${action.to}`).toBe(true)
      }
    }
  })

  it('gives every action a label rather than a raw status', () => {
    for (const status of UNIT_STATUSES) {
      for (const action of lifecycleActions({ status, condition: 'good' })) {
        expect(action.label).not.toContain('_')
      }
    }
  })

  it('gives the irreversible actions the quieter treatment', () => {
    const actions = lifecycleActions({ status: 'available', condition: 'good' })
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
    expect(lifecycleActions({ status: from, condition: 'good' }).find((one) => one.to === to)?.label).toBe(label)
  })
})

type Membership = Pick<OrganizationMembership, 'team_ids' | 'permissions'>

describe('what the unit page decides to show', () => {
  const ADMIN = 'admin' as const
  const MEMBER = 'member' as const

  const owningMember: Membership = {
    team_ids: ['team-lighting'],
    permissions: {
      inventory: 'edit', maintenance: 'none', productions: 'none', calendar: 'none',
    },
  }

  const otherTeamMember: Membership = {
    team_ids: ['team-scenic'],
    permissions: {
      inventory: 'edit', maintenance: 'none', productions: 'none', calendar: 'none',
    },
  }

  const viewer: Membership = {
    team_ids: ['team-lighting'],
    permissions: {
      inventory: 'view', maintenance: 'none', productions: 'none', calendar: 'none',
    },
  }

  function unit(status: UnitStatus, condition: 'good' | 'unusable' = 'good') {
    return { status, condition, team_id: 'team-lighting' }
  }

  it('shows an admin every action an available unit allows', () => {
    const panel = lifecyclePanel({ unit: unit('available'), role: ADMIN, membership: null })

    expect(panel.visible).toBe(true)
    expect(panel.actions.map((one) => one.label))
      .toEqual(['Mark as In Use', 'Mark Lost', 'Retire'])
  })

  it('shows an admin the actions for a unit that is out', () => {
    const panel = lifecyclePanel({ unit: unit('in_use'), role: ADMIN, membership: null })

    expect(panel.actions.map((one) => one.label)).toEqual(['Check In', 'Mark Lost'])
  })

  it('shows an admin the actions for a lost unit', () => {
    const panel = lifecyclePanel({ unit: unit('lost'), role: ADMIN, membership: null })

    expect(panel.actions.map((one) => one.label)).toEqual(['Mark as Found', 'Retire'])
  })

  it('shows an admin a retired unit with nothing to do and says why', () => {
    const panel = lifecyclePanel({ unit: unit('retired'), role: ADMIN, membership: null })

    expect(panel.visible).toBe(true)
    expect(panel.actions).toEqual([])
    expect(panel.reason).toContain('retired')
  })

  it('does not hold an admin to the unit\'s owning team', () => {
    // The bug this test exists to prevent: an Admin seeing an empty lifecycle
    // panel because a team-membership check returned false.
    const panel = lifecyclePanel({
      unit: { status: 'available', condition: 'good', team_id: 'team-nobody-is-on' },
      role: ADMIN,
      membership: { team_ids: [], permissions: owningMember.permissions },
    })

    expect(panel.visible).toBe(true)
    expect(panel.actions.length).toBeGreaterThan(0)
  })

  it('shows the owning team\'s member the same actions', () => {
    const panel = lifecyclePanel({
      unit: unit('available'), role: MEMBER, membership: owningMember,
    })

    expect(panel.visible).toBe(true)
    expect(panel.actions.map((one) => one.label))
      .toEqual(['Mark as In Use', 'Mark Lost', 'Retire'])
  })

  it('hides the section from a member of another crew', () => {
    const panel = lifecyclePanel({
      unit: unit('available'), role: MEMBER, membership: otherTeamMember,
    })

    expect(panel.visible).toBe(false)
    expect(panel.actions).toEqual([])
  })

  it('hides the section from someone with view-only inventory', () => {
    const panel = lifecyclePanel({ unit: unit('available'), role: MEMBER, membership: viewer })

    expect(panel.visible).toBe(false)
  })

  it('hides the section from an unassigned member', () => {
    const panel = lifecyclePanel({
      unit: unit('available'), role: 'unassigned', membership: null,
    })

    expect(panel.visible).toBe(false)
  })

  it('shows an unusable unit without the take-out action, and explains', () => {
    const panel = lifecyclePanel({
      unit: unit('available', 'unusable'), role: ADMIN, membership: null,
    })

    expect(panel.visible).toBe(true)
    expect(panel.actions.map((one) => one.to)).toEqual(['lost', 'retired'])
    expect(panel.reason).toContain('unusable')
  })

  it('never shows an action the service would refuse', () => {
    // The panel and the domain cannot drift: every button an admin is offered,
    // for every status and condition, is a move the model allows.
    for (const status of UNIT_STATUSES) {
      for (const condition of ['good', 'unusable'] as const) {
        const panel = lifecyclePanel({
          unit: { status, condition, team_id: 'team-lighting' },
          role: ADMIN,
          membership: null,
        })

        for (const action of panel.actions) {
          expect(canTransition(status, action.to), `${status} → ${action.to}`).toBe(true)
        }
      }
    }
  })
})

describe('what a unit row in the equipment list offers', () => {
  const ADMIN = 'admin' as const
  const MEMBER = 'member' as const

  const owningMember: Membership = {
    team_ids: ['team-lighting'],
    permissions: {
      inventory: 'edit', maintenance: 'none', productions: 'none', calendar: 'none',
    },
  }

  const otherTeamMember: Membership = {
    team_ids: ['team-scenic'],
    permissions: {
      inventory: 'edit', maintenance: 'none', productions: 'none', calendar: 'none',
    },
  }

  const viewer: Membership = {
    team_ids: ['team-lighting'],
    permissions: {
      inventory: 'view', maintenance: 'none', productions: 'none', calendar: 'none',
    },
  }

  function row(
    status: UnitStatus,
    condition: 'good' | 'unusable' = 'good',
    role: 'admin' | 'member' | 'unassigned' | null = ADMIN,
    membership: Membership | null = null,
  ) {
    return unitRowControls({
      unit: { status, condition, team_id: 'team-lighting' },
      role,
      membership,
    })
  }

  it('always offers a spelled-out way into the unit page', () => {
    // The bug this exists to prevent: the asset code was the only way in, and
    // it looked like a label rather than a link.
    for (const status of UNIT_STATUSES) {
      expect(row(status).canViewDetails, status).toBe(true)
    }
  })

  it('offers an admin status management on a unit that can move', () => {
    expect(row('available')).toMatchObject({ canManageStatus: true, canEdit: true })
  })

  it('offers the owning team\'s member the same controls', () => {
    expect(row('available', 'good', MEMBER, owningMember))
      .toMatchObject({ canManageStatus: true, canEdit: true })
  })

  it('offers a member of another crew neither', () => {
    expect(row('available', 'good', MEMBER, otherTeamMember))
      .toMatchObject({ canManageStatus: false, canEdit: false })
  })

  it('offers a view-only member neither', () => {
    expect(row('available', 'good', MEMBER, viewer))
      .toMatchObject({ canManageStatus: false, canEdit: false })
  })

  it('still lets an unauthorized member read the unit page', () => {
    expect(row('available', 'good', MEMBER, otherTeamMember).canViewDetails).toBe(true)
  })

  it('offers status management on a unit that is out', () => {
    expect(row('in_use').canManageStatus).toBe(true)
  })

  it('offers status management on a lost unit', () => {
    expect(row('lost').canManageStatus).toBe(true)
  })

  it('does not offer status management on a retired unit', () => {
    // Nothing left to do; the control would be a dead end.
    expect(row('retired').canManageStatus).toBe(false)
  })

  it('does not offer status management on a unit in maintenance', () => {
    expect(row('in_maintenance').canManageStatus).toBe(false)
  })

  it('still offers status management on an unusable unit, minus taking it out', () => {
    expect(row('available', 'unusable').canManageStatus).toBe(true)
    expect(lifecycleActions({ status: 'available', condition: 'unusable' }).map((one) => one.to))
      .toEqual(['lost', 'retired'])
  })

  it('offers exactly what the unit page offers', () => {
    // The list, the edit dialog, and the unit page all read the same helper, so
    // a move offered in one place cannot be missing from another.
    for (const status of UNIT_STATUSES) {
      for (const condition of ['good', 'unusable'] as const) {
        const unit = { status, condition, team_id: 'team-lighting' }
        const panel = lifecyclePanel({ unit, role: ADMIN, membership: null })

        expect(unitRowControls({ unit, role: ADMIN, membership: null }).canManageStatus)
          .toBe(panel.visible && panel.actions.length > 0)
      }
    }
  })
})

describe('what a unit says about repairs', () => {
  it('says nothing when there is no repair in sight', () => {
    expect(unitMaintenanceIndicator({ status: 'available' }))
      .toEqual({ currentRepairId: null, plannedRepairId: null, label: null })
  })

  it('links to the repair a unit is away for', () => {
    const shown = unitMaintenanceIndicator({
      status: 'in_maintenance', current_maintenance_record_id: 'rec-a',
    })

    expect(shown.currentRepairId).toBe('rec-a')
    expect(shown.plannedRepairId).toBeNull()
  })

  it('marks a unit that is only planned for a repair', () => {
    const shown = unitMaintenanceIndicator({
      status: 'available', planned_maintenance_record_id: 'plan-a',
    })

    expect(shown.plannedRepairId).toBe('plan-a')
    expect(shown.label).toBe('Planned for maintenance')
  })

  it('marks a unit that is in use and also planned', () => {
    // The case the whole planning model exists for: a microphone somebody is
    // using today, booked for repair next week.
    const shown = unitMaintenanceIndicator({
      status: 'in_use', planned_maintenance_record_id: 'plan-a',
    })

    expect(shown.label).toBe('Planned for maintenance')
    expect(shown.currentRepairId).toBeNull()
  })

  it('marks a lost unit that was planned, rather than dropping the plan', () => {
    const shown = unitMaintenanceIndicator({
      status: 'lost', planned_maintenance_record_id: 'plan-a',
    })

    expect(shown.plannedRepairId).toBe('plan-a')
  })

  it('never shows a unit as both at the shop and planned for it', () => {
    // Starting a repair clears the plan, so this state should not arise; if it
    // somehow did, the current repair is the truthful one.
    const shown = unitMaintenanceIndicator({
      status: 'in_maintenance',
      current_maintenance_record_id: 'rec-a',
      planned_maintenance_record_id: 'plan-a',
    })

    expect(shown.currentRepairId).toBe('rec-a')
    expect(shown.plannedRepairId).toBeNull()
    expect(shown.label).toBeNull()
  })
})

describe('a plan does not take a unit\'s controls away', () => {
  const planned = { planned_maintenance_record_id: 'plan-a' }

  it('still lets an available planned unit be taken out', () => {
    // Planning reserves nothing. The microphone can still be used this week.
    expect(lifecycleActions({ status: 'available', condition: 'good', ...planned })
      .map((one) => one.to)).toEqual(['in_use', 'lost', 'retired'])
  })

  it('still lets a planned unit that is out be checked in', () => {
    expect(lifecycleActions({ status: 'in_use', condition: 'good', ...planned })
      .map((one) => one.to)).toEqual(['available', 'lost'])
  })

  it('offers a planned unit exactly what an unplanned one gets', () => {
    for (const status of UNIT_STATUSES) {
      const withPlan = lifecycleActions({ status, condition: 'good', ...planned })
      const without = lifecycleActions({ status, condition: 'good' })

      expect(withPlan.map((one) => one.to), status).toEqual(without.map((one) => one.to))
    }
  })

  it('still exposes status management on the unit row', () => {
    const row = unitRowControls({
      unit: { status: 'available', condition: 'good', team_id: 'team-lighting', ...planned },
      role: 'admin',
      membership: null,
    })

    expect(row.canManageStatus).toBe(true)
    expect(row.canEdit).toBe(true)
  })
})
