import { describe, expect, it } from 'vitest'
import { assignableTeamIds, canEditTeamScopedRecord, hasModuleAccess } from '@/domain/module-access'
import { EMPTY_PERMISSIONS, type ModulePermissions } from '@/types/organization'

function permissions(overrides: Partial<ModulePermissions> = {}): ModulePermissions {
  return { ...EMPTY_PERMISSIONS, ...overrides }
}

describe('hasModuleAccess', () => {
  it('lets Admin through regardless of the permission map', () => {
    expect(hasModuleAccess('admin', EMPTY_PERMISSIONS, 'inventory', 'view')).toBe(true)
    expect(hasModuleAccess('admin', EMPTY_PERMISSIONS, 'inventory', 'edit')).toBe(true)
    expect(hasModuleAccess('admin', null, 'inventory', 'edit')).toBe(true)
  })

  it('denies Unassigned whatever the map says', () => {
    expect(hasModuleAccess('unassigned', permissions({ inventory: 'edit' }), 'inventory', 'view')).toBe(
      false,
    )
  })

  it('denies a member with no access to the module', () => {
    expect(hasModuleAccess('member', EMPTY_PERMISSIONS, 'inventory', 'view')).toBe(false)
  })

  it('treats edit as sufficient for view', () => {
    expect(hasModuleAccess('member', permissions({ inventory: 'edit' }), 'inventory', 'view')).toBe(
      true,
    )
  })

  it('does not treat view as sufficient for edit', () => {
    expect(hasModuleAccess('member', permissions({ inventory: 'view' }), 'inventory', 'edit')).toBe(
      false,
    )
  })

  it('keeps modules independent', () => {
    const map = permissions({ inventory: 'edit' })
    expect(hasModuleAccess('member', map, 'maintenance', 'view')).toBe(false)
    expect(hasModuleAccess('member', map, 'calendar', 'view')).toBe(false)
  })

  it('denies when there is no role at all', () => {
    expect(hasModuleAccess(null, permissions({ inventory: 'edit' }), 'inventory', 'view')).toBe(false)
  })
})

describe('canEditTeamScopedRecord', () => {
  const lighting = { team_ids: ['t-lighting'], permissions: permissions({ inventory: 'edit' }) }

  it('lets Admin edit any team, including one they do not belong to', () => {
    expect(canEditTeamScopedRecord('admin', { team_ids: [], permissions: EMPTY_PERMISSIONS }, 'inventory', 't-costume')).toBe(
      true,
    )
  })

  it('lets an edit member change their own team record', () => {
    expect(canEditTeamScopedRecord('member', lighting, 'inventory', 't-lighting')).toBe(true)
  })

  it('stops an edit member reaching another team', () => {
    expect(canEditTeamScopedRecord('member', lighting, 'inventory', 't-costume')).toBe(false)
  })

  it('stops a view member editing even their own team', () => {
    const viewer = { team_ids: ['t-lighting'], permissions: permissions({ inventory: 'view' }) }
    expect(canEditTeamScopedRecord('member', viewer, 'inventory', 't-lighting')).toBe(false)
  })

  it('stops an edit member on a record with no team', () => {
    expect(canEditTeamScopedRecord('member', lighting, 'inventory', null)).toBe(false)
  })

  it('handles a member belonging to several teams', () => {
    const both = {
      team_ids: ['t-lighting', 't-sound'],
      permissions: permissions({ inventory: 'edit' }),
    }
    expect(canEditTeamScopedRecord('member', both, 'inventory', 't-sound')).toBe(true)
    expect(canEditTeamScopedRecord('member', both, 'inventory', 't-props')).toBe(false)
  })
})

describe('assignableTeamIds', () => {
  const all = ['t-lighting', 't-sound', 't-props']

  it('offers Admin every team in the organization', () => {
    expect(assignableTeamIds('admin', { team_ids: [] }, all)).toEqual(all)
  })

  it('offers a member only their own teams', () => {
    expect(assignableTeamIds('member', { team_ids: ['t-sound'] }, all)).toEqual(['t-sound'])
  })

  it('preserves the organization ordering', () => {
    expect(assignableTeamIds('member', { team_ids: ['t-props', 't-lighting'] }, all)).toEqual([
      't-lighting',
      't-props',
    ])
  })

  it('offers nothing without a membership', () => {
    expect(assignableTeamIds('member', null, all)).toEqual([])
  })

  it('ignores team IDs the member holds that no longer exist', () => {
    expect(assignableTeamIds('member', { team_ids: ['t-gone'] }, all)).toEqual([])
  })
})
