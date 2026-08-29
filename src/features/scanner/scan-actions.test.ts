import { describe, expect, it } from 'vitest'
import { planScan, successMessage } from '@/features/scanner/scan-actions'
import { SCAN_MODES, type ScanMode } from '@/features/scanner/scan-session'
import { UNIT_STATUSES, type InventoryUnit, type UnitStatus } from '@/types/inventory'

const ORG = 'org-a'

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'unit-1',
    organization_id: ORG,
    asset_code: 'MIC-017',
    team_id: 'team-sound',
    status: 'available',
    condition: 'good',
    ...overrides,
  } as InventoryUnit
}

function plan(mode: ScanMode, u: InventoryUnit, usingTeamId: string | null = 'team-sound') {
  return planScan({ mode, unit: u, activeOrganizationId: ORG, usingTeamId })
}

describe('inspecting', () => {
  it.each(UNIT_STATUSES)('never writes, whatever state %s equipment is in', (status) => {
    // Inspect exists to confirm a label and read a state. It has no business
    // changing one.
    expect(plan('inspect', unit({ status }))).toEqual({ kind: 'inspect' })
  })

  it('does not need a using team', () => {
    expect(plan('inspect', unit(), null)).toEqual({ kind: 'inspect' })
  })
})

describe('checking equipment out', () => {
  it('takes an available unit out', () => {
    expect(plan('check_out', unit({ status: 'available' }))).toEqual({
      kind: 'mutate', to: 'in_use',
    })
  })

  it('refuses to start without a team, before anything is scanned', () => {
    // Which crew has the equipment is the point of checking it out; guessing
    // would record a fact nobody stated.
    const refusal = plan('check_out', unit(), null)
    expect(refusal.kind).toBe('refuse')
    if (refusal.kind === 'refuse') {
      expect(refusal.outcome).toBe('failed')
      expect(refusal.message).toContain('team')
    }
    expect(plan('check_out', unit(), '   ').kind).toBe('refuse')
  })

  it.each([
    ['in_use', 'already checked out'],
    ['in_maintenance', 'currently in maintenance'],
    ['lost', 'marked lost'],
    ['retired', 'retired'],
  ] as [UnitStatus, string][])('warns rather than writing for %s equipment', (status, phrase) => {
    const refusal = plan('check_out', unit({ status }))

    expect(refusal.kind).toBe('refuse')
    if (refusal.kind === 'refuse') {
      expect(refusal.outcome).toBe('warning')
      expect(refusal.message).toContain('MIC-017')
      expect(refusal.message).toContain(phrase)
    }
  })
})

describe('checking equipment in', () => {
  it('brings a unit that is out back', () => {
    expect(plan('check_in', unit({ status: 'in_use' }))).toEqual({
      kind: 'mutate', to: 'available',
    })
  })

  it('does not need a using team', () => {
    expect(plan('check_in', unit({ status: 'in_use' }), null)).toEqual({
      kind: 'mutate', to: 'available',
    })
  })

  it.each([
    ['available', 'already checked in'],
    ['in_maintenance', 'currently in maintenance'],
    ['retired', 'retired'],
  ] as [UnitStatus, string][])('warns rather than writing for %s equipment', (status, phrase) => {
    const refusal = plan('check_in', unit({ status }))

    expect(refusal.kind).toBe('refuse')
    if (refusal.kind === 'refuse') {
      expect(refusal.outcome).toBe('warning')
      expect(refusal.message).toContain(phrase)
    }
  })

  it('never marks lost equipment found on its own', () => {
    // The lifecycle permits lost -> available, which is exactly why this is
    // pinned. Marking equipment found is a decision somebody makes having read
    // its history, not a side effect of it turning up in a returns bin.
    const refusal = plan('check_in', unit({ status: 'lost' }))

    expect(refusal.kind).toBe('refuse')
    if (refusal.kind === 'refuse') {
      expect(refusal.message).toContain('marked lost')
      expect(refusal.message).toContain('details page')
    }
  })

  it('never reactivates retired equipment', () => {
    expect(plan('check_in', unit({ status: 'retired' })).kind).toBe('refuse')
    expect(plan('check_out', unit({ status: 'retired' })).kind).toBe('refuse')
  })
})

describe('a planned repair is advisory, not a lock', () => {
  it('still checks equipment out', () => {
    // Phase 11D settled this: a plan is an intention, and equipment with one
    // attached is still on the shelf and still usable.
    expect(plan('check_out', unit({
      status: 'available', planned_maintenance_record_id: 'plan-1',
    } as Partial<InventoryUnit>))).toEqual({ kind: 'mutate', to: 'in_use' })
  })

  it('still checks equipment in', () => {
    expect(plan('check_in', unit({
      status: 'in_use', planned_maintenance_record_id: 'plan-1',
    } as Partial<InventoryUnit>))).toEqual({ kind: 'mutate', to: 'available' })
  })

  it('and repair history does not block either', () => {
    expect(plan('check_out', unit({
      status: 'available', maintenance_record_ids: ['r1', 'r2'],
    } as Partial<InventoryUnit>)).kind).toBe('mutate')
  })
})

describe('equipment from another organization', () => {
  it.each(SCAN_MODES)('is never acted on in %s mode', (mode) => {
    // A scanner session is opened inside one organization on purpose. Reading
    // succeeded, so this person may see the unit — but a sweep must not reach
    // sideways into another organization's inventory, and must not switch the
    // whole application out from under the session either.
    const refusal = planScan({
      mode,
      unit: unit({ organization_id: 'org-b' }),
      activeOrganizationId: ORG,
      usingTeamId: 'team-sound',
    })

    expect(refusal.kind).toBe('refuse')
    if (refusal.kind === 'refuse') {
      expect(refusal.outcome).toBe('warning')
      expect(refusal.message).toBe('This equipment belongs to another organization.')
    }
  })

  it('says nothing about the equipment itself', () => {
    const refusal = planScan({
      mode: 'check_out',
      unit: unit({ organization_id: 'org-b' }),
      activeOrganizationId: ORG,
      usingTeamId: 'team-sound',
    })

    if (refusal.kind !== 'refuse') throw new Error('expected a refusal')
    for (const leak of ['MIC-017', 'org-b', 'team-sound', 'available']) {
      expect(refusal.message).not.toContain(leak)
    }
  })

  it('is refused with no organization open at all', () => {
    expect(planScan({
      mode: 'inspect', unit: unit(), activeOrganizationId: null, usingTeamId: null,
    }).kind).toBe('refuse')
  })
})

describe('what a finished scan says', () => {
  it('names the equipment and what happened to it', () => {
    expect(successMessage('check_out', unit())).toBe('MIC-017 checked out.')
    expect(successMessage('check_in', unit())).toBe('MIC-017 checked in.')
    expect(successMessage('inspect', unit({ status: 'in_use' }))).toContain('MIC-017')
    expect(successMessage('inspect', unit({ status: 'in_use' }))).toContain('In use')
  })

  it('stays readable when a unit somehow has no asset code', () => {
    expect(successMessage('check_out', unit({ asset_code: '' })))
      .toBe('This equipment checked out.')
  })
})
