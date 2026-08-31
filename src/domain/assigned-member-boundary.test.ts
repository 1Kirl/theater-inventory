import { describe, expect, it } from 'vitest'
import { effectiveRole, satisfiesAssignmentCondition } from '@/domain/effective-role'
import { hasModuleAccess, type RequiredLevel } from '@/domain/module-access'
import { PERMISSION_MODULES, EMPTY_PERMISSIONS } from '@/types/organization'
import type {
  ModulePermissions, OrganizationMembership, PermissionLevel, PermissionModule,
} from '@/types/organization'

/**
 * Extension D: what a membership document alone is worth.
 *
 * `module-access.test.ts` takes the role as a given and asks what the
 * permission map adds. That is the right question for that file and the wrong
 * one for this defect: the divergence between the interface and Security Rules
 * was never inside `hasModuleAccess`, it was in nobody asserting the whole
 * answer from the one input both sides actually receive — a membership
 * document.
 *
 * So every case here starts at `team_ids`, `permissions`, and `is_active`, runs
 * the same two steps every call site runs, and pins the result. The cases are
 * deliberately the same ones tests/rules/assigned-member-boundary.test.ts
 * proves against the emulator, so the two files can be read side by side.
 */

const ADMIN_UID = 'uid-admin'
const MEMBER_UID = 'uid-member'
const ORGANIZATION = { admin_uid: ADMIN_UID }
const TEAM = 't-lighting'

type Membership = Pick<OrganizationMembership, 'is_active' | 'team_ids' | 'permissions'>

function permissions(level: PermissionLevel): ModulePermissions {
  return { inventory: level, maintenance: level, productions: level, calendar: level }
}

function membership(o: {
  isActive?: boolean
  teamIds?: string[]
  level?: PermissionLevel
} = {}): Membership {
  return {
    is_active: o.isActive !== false,
    team_ids: o.teamIds ?? [],
    permissions: permissions(o.level ?? 'none'),
  }
}

/** The two steps every call site runs: role from the membership, then module. */
function canAccess(
  uid: string,
  m: Membership | null,
  module: PermissionModule,
  level: RequiredLevel,
): boolean {
  return hasModuleAccess(effectiveRole(ORGANIZATION, m, uid), m?.permissions ?? null, module, level)
}

interface Case {
  name: string
  uid: string
  membership: Membership | null
  view: boolean
  edit: boolean
}

const CASES: Case[] = [
  {
    name: 'active, permission at view, no team',
    uid: MEMBER_UID,
    membership: membership({ teamIds: [], level: 'view' }),
    view: false,
    edit: false,
  },
  {
    name: 'active, permission at edit, no team',
    uid: MEMBER_UID,
    membership: membership({ teamIds: [], level: 'edit' }),
    view: false,
    edit: false,
  },
  {
    name: 'active, permission at view, one team',
    uid: MEMBER_UID,
    membership: membership({ teamIds: [TEAM], level: 'view' }),
    view: true,
    edit: false,
  },
  {
    name: 'active, permission at edit, one team',
    uid: MEMBER_UID,
    membership: membership({ teamIds: [TEAM], level: 'edit' }),
    view: true,
    edit: true,
  },
  {
    name: 'active, one team, no permission',
    uid: MEMBER_UID,
    membership: membership({ teamIds: [TEAM], level: 'none' }),
    view: false,
    edit: false,
  },
  {
    name: 'deactivated, one team, permission at edit',
    uid: MEMBER_UID,
    membership: membership({ isActive: false, teamIds: [TEAM], level: 'edit' }),
    view: false,
    edit: false,
  },
  {
    name: 'Admin with neither team nor permission',
    uid: ADMIN_UID,
    membership: membership({ teamIds: [], level: 'none' }),
    view: true,
    edit: true,
  },
  {
    // Administration is the organization's admin_uid, not the membership.
    name: 'Admin whose membership was never written',
    uid: ADMIN_UID,
    membership: null,
    view: true,
    edit: true,
  },
  {
    name: 'no membership at all',
    uid: MEMBER_UID,
    membership: null,
    view: false,
    edit: false,
  },
]

describe.each(PERMISSION_MODULES)('%s module access from a membership', (module) => {
  it.each(CASES)('$name', ({ uid, membership, view, edit }) => {
    expect(canAccess(uid, membership, module, 'view')).toBe(view)
    expect(canAccess(uid, membership, module, 'edit')).toBe(edit)
  })
})

/**
 * The invariant the Rules now share: nothing a non-Admin can store in
 * `permissions` opens a module while `team_ids` is empty. Stated over every
 * membership shape rather than the listed cases, so a future change to
 * `satisfiesAssignmentCondition` cannot satisfy the table while breaking the
 * rule the table exists to express.
 */
describe('unassigned means unassigned', () => {
  const SHAPES: Membership[] = [true, false].flatMap((isActive) =>
    [[], [TEAM], [TEAM, 't-sound']].flatMap((teamIds) =>
      (['none', 'view', 'edit'] as const).map((level) =>
        membership({ isActive, teamIds, level }))))

  const MIXED: Membership[] = [
    { is_active: true, team_ids: [], permissions: { ...EMPTY_PERMISSIONS, calendar: 'edit' } },
    { is_active: true, team_ids: [], permissions: { ...EMPTY_PERMISSIONS, inventory: 'view' } },
    { is_active: true, team_ids: [TEAM], permissions: { ...EMPTY_PERMISSIONS, calendar: 'view' } },
  ]

  it.each([...SHAPES, ...MIXED])('grants no module when the role is unassigned', (m) => {
    if (effectiveRole(ORGANIZATION, m, MEMBER_UID) !== 'unassigned') return

    for (const module of PERMISSION_MODULES) {
      expect(canAccess(MEMBER_UID, m, module, 'view')).toBe(false)
      expect(canAccess(MEMBER_UID, m, module, 'edit')).toBe(false)
    }
  })

  it('calls every teamless membership unassigned, whatever it was granted', () => {
    for (const level of ['view', 'edit'] as const) {
      const m = membership({ teamIds: [], level })
      expect(satisfiesAssignmentCondition(m)).toBe(false)
      expect(effectiveRole(ORGANIZATION, m, MEMBER_UID)).toBe('unassigned')
    }
  })

  it('covers at least one teamless case that carries a permission', () => {
    const teamless = [...SHAPES, ...MIXED].filter(
      (m) => m.is_active && m.team_ids.length === 0
        && Object.values(m.permissions).some((level) => level !== 'none'),
    )
    expect(teamless.length).toBeGreaterThan(0)
  })
})
