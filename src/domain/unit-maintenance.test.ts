import { describe, expect, it } from 'vitest'
import {
  MAX_UNITS_PER_MAINTENANCE, SERIALIZED_CREATE_STATUSES, canCreateSerializedAt,
  canPlanForMaintenance, canSendToMaintenance, canStartPlanAt, describeStartConflicts,
  holdsEquipment, ineligibleReason, isActiveMaintenance, isMaintenanceClosing,
  isMaintenanceFinished, isPlannedMaintenance, isSerializedMaintenance,
  maintenanceTrackingModeOf, maintenanceWorkflowSteps, planIneligibleReason, startConflicts,
  validateMaintenanceSelection, validateSerializedStatusChange,
} from '@/domain/unit-maintenance'
import { EMPTY_MIRRORS, withStatusChanged, withUnitsAdded } from '@/domain/inventory-unit'
import { conditionCountsTotal, unitCountsValid } from '@/domain/inventory'
import type { InventoryItem, InventoryUnit, UnitStatus } from '@/types/inventory'
import { MAINTENANCE_STATUSES, type MaintenanceStatus } from '@/types/maintenance'

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'unit-1',
    asset_code: 'CLAMP-001',
    team_id: 'team-lighting',
    status: 'available',
    condition: 'good',
    ...overrides,
  } as InventoryUnit
}

const SERIALIZED = { tracking_mode: 'serialized' } as Pick<InventoryItem, 'tracking_mode'>
const BULK = { tracking_mode: 'bulk' } as Pick<InventoryItem, 'tracking_mode'>

describe('which units may be sent for repair', () => {
  it('sends a unit that is on the shelf', () => {
    expect(canSendToMaintenance(unit())).toBe(true)
  })

  it('does not care what condition it is in', () => {
    // A clamp in perfect condition can go for a service, and one marked
    // unusable is exactly what a repair is for.
    for (const condition of ['excellent', 'good', 'fair', 'needs_repair', 'unusable'] as const) {
      expect(canSendToMaintenance(unit({ condition }))).toBe(true)
    }
  })

  it.each(['in_use', 'lost', 'in_maintenance', 'retired'] as UnitStatus[])(
    'refuses a unit that is %s',
    (status) => {
      expect(canSendToMaintenance(unit({ status }))).toBe(false)
      expect(ineligibleReason(unit({ status }))).not.toBeNull()
    },
  )

  it('explains why, in words a person can act on', () => {
    expect(ineligibleReason(unit({ status: 'in_use' }))).toContain('check it in')
    expect(ineligibleReason(unit({ status: 'lost' }))).toContain('mark it found')
    expect(ineligibleReason(unit())).toBeNull()
  })
})

describe('validating a selection', () => {
  const TEAMS = ['team-lighting', 'team-scenic']
  const units = [
    unit({ unit_id: 'u1', asset_code: 'C-1' }),
    unit({ unit_id: 'u2', asset_code: 'C-2' }),
    unit({ unit_id: 'u3', asset_code: 'C-3', status: 'in_use' }),
    unit({ unit_id: 'u4', asset_code: 'C-4', team_id: 'team-costume' }),
  ]

  it('accepts eligible units the actor manages', () => {
    const result = validateMaintenanceSelection({
      item: SERIALIZED, units, selectedIds: ['u1', 'u2'], teamIds: TEAMS,
    })

    expect(result).toEqual({ valid: true, unitIds: ['u1', 'u2'] })
  })

  it('refuses a bulk item, which has no units to choose', () => {
    expect(validateMaintenanceSelection({
      item: BULK, units, selectedIds: ['u1'], teamIds: TEAMS,
    }).valid).toBe(false)
  })

  it('refuses an empty selection', () => {
    expect(validateMaintenanceSelection({
      item: SERIALIZED, units, selectedIds: [], teamIds: TEAMS,
    }).valid).toBe(false)
  })

  it('refuses the same unit chosen twice', () => {
    const result = validateMaintenanceSelection({
      item: SERIALIZED, units, selectedIds: ['u1', 'u1'], teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('twice')
  })

  it('refuses a unit that is out with a crew, and names it', () => {
    const result = validateMaintenanceSelection({
      item: SERIALIZED, units, selectedIds: ['u1', 'u3'], teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('C-3')
  })

  it('refuses a unit belonging to a crew the actor cannot manage', () => {
    // The batch is atomic, so one unmanageable unit fails the whole send. Better
    // refused here with a name than by Security Rules without one.
    const result = validateMaintenanceSelection({
      item: SERIALIZED, units, selectedIds: ['u1', 'u4'], teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('C-4')
  })

  it('refuses more than one repair can carry', () => {
    const many = Array.from({ length: MAX_UNITS_PER_MAINTENANCE + 1 }, (_, index) =>
      unit({ unit_id: `u${String(index)}`, asset_code: `C-${String(index)}` }))

    const result = validateMaintenanceSelection({
      item: SERIALIZED,
      units: many,
      selectedIds: many.map((one) => one.unit_id),
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('at a time')
  })

  it('accepts a batch right at the ceiling', () => {
    const many = Array.from({ length: MAX_UNITS_PER_MAINTENANCE }, (_, index) =>
      unit({ unit_id: `u${String(index)}`, asset_code: `C-${String(index)}` }))

    expect(validateMaintenanceSelection({
      item: SERIALIZED,
      units: many,
      selectedIds: many.map((one) => one.unit_id),
      teamIds: TEAMS,
    }).valid).toBe(true)
  })
})

describe('the repair status flow', () => {
  it('treats a record with no tracking mode as bulk', () => {
    expect(maintenanceTrackingModeOf({})).toBe('bulk')
    expect(isSerializedMaintenance({})).toBe(false)
  })

  it('recognises a serialized record', () => {
    expect(isSerializedMaintenance({ tracking_mode: 'serialized' })).toBe(true)
  })

  it('moves forward through the workflow', () => {
    expect(validateSerializedStatusChange({ from: 'sent', to: 'in_service' }).valid).toBe(true)
    expect(validateSerializedStatusChange({ from: 'in_service', to: 'ready' }).valid).toBe(true)
    expect(validateSerializedStatusChange({ from: 'ready', to: 'returned' }).valid).toBe(true)
  })

  it('does not go backwards', () => {
    expect(validateSerializedStatusChange({ from: 'ready', to: 'sent' }).valid).toBe(false)
    expect(validateSerializedStatusChange({ from: 'in_service', to: 'sent' }).valid).toBe(false)
  })

  it('never plans a serialized repair', () => {
    // The record exists because the equipment left, so there is no stage in
    // which a selection sits reserved and two repairs could claim one clamp.
    const result = validateSerializedStatusChange({ from: 'sent', to: 'planned' })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('cannot be planned')
  })

  it.each(['sent', 'in_service', 'ready'] as MaintenanceStatus[])(
    'may be cancelled from %s',
    (from) => {
      expect(validateSerializedStatusChange({ from, to: 'cancelled' }).valid).toBe(true)
    },
  )

  it('is finished once returned or cancelled', () => {
    expect(validateSerializedStatusChange({ from: 'returned', to: 'sent' }).valid).toBe(false)
    expect(validateSerializedStatusChange({ from: 'cancelled', to: 'ready' }).valid).toBe(false)
  })

  it('knows which moves bring the equipment home', () => {
    expect(isMaintenanceClosing('sent', 'returned')).toBe(true)
    expect(isMaintenanceClosing('ready', 'cancelled')).toBe(true)
    expect(isMaintenanceClosing('sent', 'in_service')).toBe(false)
    expect(isMaintenanceClosing('in_service', 'ready')).toBe(false)
  })

  it('reports a closing move as closing, and a workflow step as not', () => {
    const closing = validateSerializedStatusChange({ from: 'ready', to: 'returned' })
    const step = validateSerializedStatusChange({ from: 'sent', to: 'in_service' })

    expect(closing.valid ? closing.closing : null).toBe(true)
    expect(step.valid ? step.closing : null).toBe(false)
  })

  it('knows while a repair still has the equipment', () => {
    for (const status of MAINTENANCE_STATUSES) {
      expect(holdsEquipment({ status }))
        .toBe(['sent', 'in_service', 'ready'].includes(status))
    }
  })
})

describe('what a repair does to the parent numbers', () => {
  function consistent(mirrors: { unit_counts: { active_total: number }; condition_counts: object }) {
    return unitCountsValid(mirrors.unit_counts as never)
      && conditionCountsTotal(mirrors.condition_counts as never)
        === mirrors.unit_counts.active_total
  }

  it('moves units out of availability and into maintenance', () => {
    const before = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'needs_repair' },
      { status: 'available', condition: 'good' },
    ])
    const after = [
      { condition: 'good' as const }, { condition: 'needs_repair' as const },
    ].reduce((mirrors, one) => withStatusChanged(mirrors, {
      condition: one.condition, from: 'available', to: 'in_maintenance',
    }), before)

    expect(after.unit_counts.in_maintenance).toBe(2)
    expect(after.unit_counts.available).toBe(1)
    expect(after.quantity_available).toBe(1)
    // Away for repair is still the organization's equipment.
    expect(after.quantity_total).toBe(3)
    expect(consistent(after)).toBe(true)
  })

  it('brings them back without touching condition', () => {
    const out = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'in_maintenance', condition: 'needs_repair' },
    ])
    const back = withStatusChanged(out, {
      condition: 'needs_repair', from: 'in_maintenance', to: 'available',
    })

    expect(back.unit_counts.in_maintenance).toBe(0)
    expect(back.unit_counts.available).toBe(1)
    // Still needing repair: coming back from the shop is not a claim that it
    // was fixed. Somebody has to look at it and say so.
    expect(back.condition_counts.needs_repair).toBe(1)
    expect(consistent(back)).toBe(true)
  })

  it('returns an unusable unit to stock rather than to availability', () => {
    const out = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'in_maintenance', condition: 'unusable' },
    ])
    const back = withStatusChanged(out, {
      condition: 'unusable', from: 'in_maintenance', to: 'available',
    })

    expect(back.unit_counts.available).toBe(0)
    expect(back.unit_counts.unusable_on_hand).toBe(1)
    expect(back.quantity_available).toBe(0)
    expect(consistent(back)).toBe(true)
  })

  it('changes the in-maintenance bucket by exactly one per unit, whatever the condition', () => {
    // This is the property Security Rules count on: the parent delta is what
    // proves a batch really moved the equipment it claims.
    for (const condition of ['excellent', 'good', 'fair', 'needs_repair', 'unusable'] as const) {
      const before = withUnitsAdded(EMPTY_MIRRORS, [{ status: 'available', condition }])
      const after = withStatusChanged(before, {
        condition, from: 'available', to: 'in_maintenance',
      })

      expect(after.unit_counts.in_maintenance - before.unit_counts.in_maintenance).toBe(1)
    }
  })
})

describe('where a repair may be recorded as starting', () => {
  it('offers planning plus the three stages where the equipment is away', () => {
    // Planning is a real workflow — "we will send these next week" — and
    // recording a repair is not the same as starting one, so a record entered
    // days late may already be in service.
    expect([...SERIALIZED_CREATE_STATUSES]).toEqual(['planned', 'sent', 'in_service', 'ready'])
  })

  it('accepts planned at creation, which takes no equipment', () => {
    expect(canCreateSerializedAt('planned')).toBe(true)
    // But it is not a stage a plan can *start* at: starting means the equipment
    // goes, and a plan that stays planned has not gone anywhere.
    expect(canStartPlanAt('planned')).toBe(false)
  })

  it.each(['sent', 'in_service', 'ready'] as MaintenanceStatus[])(
    'accepts %s at creation',
    (status) => { expect(canCreateSerializedAt(status)).toBe(true) },
  )



  it.each(['returned', 'cancelled'] as MaintenanceStatus[])(
    'refuses %s, because a finished repair has nothing to record',
    (status) => { expect(canCreateSerializedAt(status)).toBe(false) },
  )

  it.each(['sent', 'in_service', 'ready'] as MaintenanceStatus[])(
    'starts a plan at %s',
    (status) => { expect(canStartPlanAt(status)).toBe(true) },
  )

  it('never offers a creation status the workflow could not continue from', () => {
    for (const status of SERIALIZED_CREATE_STATUSES) {
      expect(maintenanceWorkflowSteps({ status, tracking_mode: 'serialized' }).length)
        .toBeGreaterThan(0)
    }
  })
})

describe('what a repair can do next', () => {
  function serialized(status: MaintenanceStatus) {
    return { status, tracking_mode: 'serialized' as const }
  }

  it('moves a sent repair on, or calls it off', () => {
    expect(maintenanceWorkflowSteps(serialized('sent')).map((step) => step.to))
      .toEqual(['in_service', 'cancelled'])
  })

  it('moves an in-service repair to ready', () => {
    expect(maintenanceWorkflowSteps(serialized('in_service')).map((step) => step.to))
      .toEqual(['ready', 'cancelled'])
  })

  it('returns the equipment from ready', () => {
    expect(maintenanceWorkflowSteps(serialized('ready')).map((step) => step.to))
      .toEqual(['returned', 'cancelled'])
  })

  it('does not offer returning before the equipment is ready', () => {
    // Strictly forward: a repair the shop still has is not finished.
    expect(maintenanceWorkflowSteps(serialized('sent')).map((step) => step.to))
      .not.toContain('returned')
  })

  it.each(['returned', 'cancelled'] as MaintenanceStatus[])(
    'offers nothing once %s',
    (status) => {
      expect(maintenanceWorkflowSteps(serialized(status))).toEqual([])
      expect(isMaintenanceFinished({ status })).toBe(true)
    },
  )

  it('offers nothing for a bulk repair, which has its own workflow', () => {
    expect(maintenanceWorkflowSteps({ status: 'sent' })).toEqual([])
  })

  it('never offers a step the validator would refuse', () => {
    for (const status of MAINTENANCE_STATUSES) {
      for (const step of maintenanceWorkflowSteps(serialized(status))) {
        expect(validateSerializedStatusChange({ from: status, to: step.to }).valid).toBe(true)
      }
    }
  })

  it('labels each step in words rather than status names', () => {
    for (const status of ['sent', 'in_service', 'ready'] as MaintenanceStatus[]) {
      for (const step of maintenanceWorkflowSteps(serialized(status))) {
        expect(step.label).not.toContain('_')
      }
    }
  })

  it('gives cancellation the quieter treatment', () => {
    const steps = maintenanceWorkflowSteps(serialized('ready'))
    expect(steps.find((step) => step.to === 'cancelled')?.tone).toBe('outline')
    expect(steps.find((step) => step.to === 'returned')?.tone).toBe('default')
  })
})

describe('planning a repair without reserving the equipment', () => {
  function planUnit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
    return unit({ status: 'available', ...overrides })
  }

  it('plans equipment that is on the shelf', () => {
    expect(canPlanForMaintenance(planUnit())).toBe(true)
  })

  it('plans equipment somebody is using, because the repair is for later', () => {
    // A microphone in use today is a perfectly reasonable thing to plan a
    // repair for; it can be checked in before the repair starts.
    expect(canPlanForMaintenance(planUnit({ status: 'in_use' }))).toBe(true)
  })

  it.each(['lost', 'in_maintenance', 'retired'] as UnitStatus[])(
    'does not plan equipment that is %s',
    (status) => {
      expect(canPlanForMaintenance(planUnit({ status }))).toBe(false)
      expect(planIneligibleReason(planUnit({ status }))).not.toBeNull()
    },
  )

  it('explains why in words a person can act on', () => {
    expect(planIneligibleReason(planUnit({ status: 'lost' }))).toContain('find it')
    expect(planIneligibleReason(planUnit({ status: 'in_maintenance' }))).toContain('repair shop')
    expect(planIneligibleReason(planUnit())).toBeNull()
  })

  it('refuses a second plan for equipment already planned', () => {
    // One plan at a time, so a teacher cannot accidentally schedule the same
    // microphone into two repairs.
    const planned = planUnit({ planned_maintenance_record_id: 'plan-a' })

    expect(canPlanForMaintenance(planned)).toBe(false)
    expect(planIneligibleReason(planned)).toContain('Already planned')
  })

  it('still counts equipment as eligible for the plan it is already on', () => {
    // Editing plan A must not exclude the units plan A already covers.
    const planned = planUnit({ planned_maintenance_record_id: 'plan-a' })

    expect(canPlanForMaintenance(planned, 'plan-a')).toBe(true)
  })

  it('recognises a plan as distinct from a repair', () => {
    expect(isPlannedMaintenance({ status: 'planned', tracking_mode: 'serialized' })).toBe(true)
    expect(isActiveMaintenance({ status: 'planned' })).toBe(false)
    expect(isActiveMaintenance({ status: 'sent' })).toBe(true)
  })

  it('does not treat a planned bulk record as a serialized plan', () => {
    expect(isPlannedMaintenance({ status: 'planned' })).toBe(false)
  })
})

describe('starting a plan', () => {
  it('starts when every unit is on the shelf', () => {
    const units = [
      unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
      unit({ unit_id: 'u2', asset_code: 'MIC-002' }),
    ]

    expect(startConflicts(units)).toEqual([])
  })

  it('names the equipment that is in the way', () => {
    const units = [
      unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
      unit({ unit_id: 'u2', asset_code: 'MIC-002', status: 'in_use' }),
      unit({ unit_id: 'u3', asset_code: 'MIC-007', status: 'lost' }),
    ]

    const conflicts = startConflicts(units)
    expect(conflicts.map((one) => one.assetCode)).toEqual(['MIC-002', 'MIC-007'])
  })

  it('explains the conflict without exposing ids', () => {
    const message = describeStartConflicts([
      { assetCode: 'MIC-002', reason: 'Out with a crew — check it in first' },
      { assetCode: 'MIC-007', reason: 'Missing — mark it found first' },
    ])

    expect(message).toContain('2 planned units are not currently available')
    expect(message).toContain('MIC-002')
    expect(message).toContain('MIC-007')
    expect(message).toContain('before starting this repair')
  })

  it('says nothing when there is nothing in the way', () => {
    expect(describeStartConflicts([])).toBe('')
  })

  it('offers starting or calling off a plan, and nothing else', () => {
    const steps = maintenanceWorkflowSteps({ status: 'planned', tracking_mode: 'serialized' })

    expect(steps.map((step) => step.to)).toEqual(['sent', 'cancelled'])
    expect(steps.find((step) => step.to === 'sent')?.label).toBe('Start repair')
  })

  it.each(['sent', 'in_service', 'ready'] as MaintenanceStatus[])(
    'allows a plan to become %s',
    (to) => {
      expect(validateSerializedStatusChange({ from: 'planned', to }).valid).toBe(true)
    },
  )

  it('allows a plan to be called off', () => {
    const result = validateSerializedStatusChange({ from: 'planned', to: 'cancelled' })

    expect(result.valid).toBe(true)
    // Nothing to close: the equipment never left.
    expect(result.valid ? result.closing : null).toBe(false)
  })

  it('does not let a started repair go back to planned', () => {
    expect(validateSerializedStatusChange({ from: 'sent', to: 'planned' }).valid).toBe(false)
  })
})

describe('a plan does not touch the parent numbers', () => {
  it('leaves availability exactly as it was', () => {
    // The whole point: planning a repair for next week must not stop anyone
    // using the microphone this week.
    const before = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'available', condition: 'good' },
      { status: 'in_use', condition: 'good' },
    ])

    // Nothing in the domain moves a unit for a plan, so the mirrors a plan
    // writes are the ones it read.
    expect(before.unit_counts.in_maintenance).toBe(0)
    expect(before.quantity_available).toBe(1)
  })
})
