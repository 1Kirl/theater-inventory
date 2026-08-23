import { describe, expect, it } from 'vitest'
import { effectiveRole, hasAnyModuleAccess, satisfiesAssignmentCondition } from '@/domain/effective-role'
import { EMPTY_PERMISSIONS, type ModulePermissions } from '@/types/organization'

const ADMIN_UID = 'uid-admin'
const MEMBER_UID = 'uid-member'

const organization = { admin_uid: ADMIN_UID }

function permissions(overrides: Partial<ModulePermissions> = {}): ModulePermissions {
  return { ...EMPTY_PERMISSIONS, ...overrides }
}

function membership(overrides: Partial<{
  is_active: boolean
  team_ids: string[]
  permissions: ModulePermissions
}> = {}) {
  return {
    is_active: true,
    team_ids: ['team-lighting'],
    permissions: permissions({ inventory: 'view' }),
    ...overrides,
  }
}

describe('hasAnyModuleAccess', () => {
  it('is false when every module is none', () => {
    expect(hasAnyModuleAccess(EMPTY_PERMISSIONS)).toBe(false)
  })

  it('is true when any single module is view or edit', () => {
    for (const module of ['inventory', 'maintenance', 'productions', 'calendar'] as const) {
      expect(hasAnyModuleAccess(permissions({ [module]: 'view' })), module).toBe(true)
      expect(hasAnyModuleAccess(permissions({ [module]: 'edit' })), module).toBe(true)
    }
  })
})

describe('satisfiesAssignmentCondition', () => {
  it('needs both a team and a module', () => {
    expect(satisfiesAssignmentCondition(membership())).toBe(true)
  })

  it('is false without a team', () => {
    expect(satisfiesAssignmentCondition(membership({ team_ids: [] }))).toBe(false)
  })

  it('is false without any module above none', () => {
    expect(satisfiesAssignmentCondition(membership({ permissions: EMPTY_PERMISSIONS }))).toBe(false)
  })

  it('is false when the membership is deactivated', () => {
    expect(satisfiesAssignmentCondition(membership({ is_active: false }))).toBe(false)
  })

  it('is false when there is no membership at all', () => {
    expect(satisfiesAssignmentCondition(null)).toBe(false)
  })
})

describe('effectiveRole', () => {
  it('reads Admin from the organization, not from the membership', () => {
    expect(effectiveRole(organization, null, ADMIN_UID)).toBe('admin')
  })

  it('reads Admin even with no teams and no permissions', () => {
    const bare = membership({ team_ids: [], permissions: EMPTY_PERMISSIONS })
    expect(effectiveRole(organization, bare, ADMIN_UID)).toBe('admin')
  })

  it('reads Admin even when the membership is deactivated', () => {
    expect(effectiveRole(organization, membership({ is_active: false }), ADMIN_UID)).toBe('admin')
  })

  it('reads Member when the assignment condition holds', () => {
    expect(effectiveRole(organization, membership(), MEMBER_UID)).toBe('member')
  })

  it('reads Unassigned for a fresh join', () => {
    const fresh = membership({ team_ids: [], permissions: EMPTY_PERMISSIONS })
    expect(effectiveRole(organization, fresh, MEMBER_UID)).toBe('unassigned')
  })

  it('reads Unassigned with teams but no module access', () => {
    expect(effectiveRole(organization, membership({ permissions: EMPTY_PERMISSIONS }), MEMBER_UID)).toBe(
      'unassigned',
    )
  })

  it('reads Unassigned with module access but no team', () => {
    expect(effectiveRole(organization, membership({ team_ids: [] }), MEMBER_UID)).toBe('unassigned')
  })

  it('reads Unassigned when deactivated, whatever the membership holds', () => {
    const full = membership({
      is_active: false,
      team_ids: ['team-lighting'],
      permissions: permissions({ inventory: 'edit', calendar: 'edit' }),
    })
    expect(effectiveRole(organization, full, MEMBER_UID)).toBe('unassigned')
  })

  it('reads Unassigned when no membership exists', () => {
    expect(effectiveRole(organization, null, MEMBER_UID)).toBe('unassigned')
  })

  describe('transfer of administration', () => {
    const before = { admin_uid: ADMIN_UID }
    const after = { admin_uid: MEMBER_UID }

    it('promotes the target without touching their membership', () => {
      const target = membership({ team_ids: [], permissions: EMPTY_PERMISSIONS })

      expect(effectiveRole(before, target, MEMBER_UID)).toBe('unassigned')
      expect(effectiveRole(after, target, MEMBER_UID)).toBe('admin')
    })

    it('leaves the outgoing Admin a Member when their preserved data qualifies', () => {
      const outgoing = membership({
        team_ids: ['team-stage'],
        permissions: permissions({ productions: 'edit' }),
      })

      expect(effectiveRole(before, outgoing, ADMIN_UID)).toBe('admin')
      expect(effectiveRole(after, outgoing, ADMIN_UID)).toBe('member')
    })

    it('leaves the outgoing Admin Unassigned when they never held an assignment', () => {
      const outgoing = membership({ team_ids: [], permissions: EMPTY_PERMISSIONS })

      expect(effectiveRole(before, outgoing, ADMIN_UID)).toBe('admin')
      expect(effectiveRole(after, outgoing, ADMIN_UID)).toBe('unassigned')
    })
  })
})
