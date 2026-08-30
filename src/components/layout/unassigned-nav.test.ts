import { describe, expect, it } from 'vitest'
import { navItems } from '@/components/layout/nav-items'
import { hasModuleAccess } from '@/domain/module-access'
import { paths } from '@/routes/paths'
import type { EffectiveRole } from '@/domain/effective-role'
import type { ModulePermissions } from '@/types/organization'

/**
 * What somebody waiting for an assignment can see.
 *
 * Contacts opens to them deliberately: they joined with a code, their
 * membership is active, and knowing who else is here is not a module
 * permission. Everything else stays shut, and this is where that stays true —
 * a link that leads back to "you are not assigned" is worse than no link.
 */

/** The same filter the sidebar applies. */
function visibleTo(role: EffectiveRole, permissions: ModulePermissions | null, isAdmin: boolean) {
  return navItems
    .filter((item) => {
      if (role === 'unassigned') return item.availableToUnassigned === true
      if (item.adminOnly && !isAdmin) return false
      if (item.module) return hasModuleAccess(role, permissions, item.module, 'view')
      return true
    })
    .map((item) => item.label)
}

const NONE: ModulePermissions = {
  inventory: 'none', maintenance: 'none', productions: 'none', calendar: 'none',
}
const ALL_VIEW: ModulePermissions = {
  inventory: 'view', maintenance: 'view', productions: 'view', calendar: 'view',
}

describe('an unassigned member', () => {
  it('is offered the directory', () => {
    expect(visibleTo('unassigned', NONE, false)).toEqual(['Contacts'])
  })

  it('is offered no module, whatever their permissions map happens to say', () => {
    // Their role is what decides. A stale permissions map on an unassigned
    // membership must not open anything.
    for (const label of ['Inventory', 'Maintenance', 'Productions', 'Action List', 'Calendar', 'Scan']) {
      expect(visibleTo('unassigned', ALL_VIEW, false)).not.toContain(label)
    }
  })

  it('is not offered the dashboard, which would bounce them back', () => {
    expect(visibleTo('unassigned', NONE, false)).not.toContain('Dashboard')
  })

  it('is not offered administration', () => {
    expect(visibleTo('unassigned', NONE, true)).not.toContain('Organization Settings')
  })
})

describe('everybody else is unaffected', () => {
  it('still shows an assigned member what their permissions allow', () => {
    const visible = visibleTo('member', ALL_VIEW, false)

    expect(visible).toContain('Dashboard')
    expect(visible).toContain('Inventory')
    expect(visible).toContain('Contacts')
    expect(visible).not.toContain('Organization Settings')
  })

  it('still hides a module a member cannot view', () => {
    const visible = visibleTo('member', { ...NONE, inventory: 'view' }, false)

    expect(visible).toContain('Inventory')
    expect(visible).not.toContain('Maintenance')
    expect(visible).not.toContain('Calendar')
  })

  it('still shows the Admin everything, including settings', () => {
    const visible = visibleTo('admin', ALL_VIEW, true)

    expect(visible).toContain('Organization Settings')
    expect(visible).toContain('Contacts')
  })
})

describe('the directory entry itself', () => {
  it('carries no module permission, because membership is the qualification', () => {
    const contacts = navItems.find((item) => item.path === paths.contacts)

    expect(contacts).toBeDefined()
    expect(contacts?.module).toBeUndefined()
    expect(contacts?.adminOnly).toBe(false)
    expect(contacts?.availableToUnassigned).toBe(true)
  })

  it('is the only entry an unassigned member may open', () => {
    const open = navItems.filter((item) => item.availableToUnassigned === true)
    expect(open.map((item) => item.path)).toEqual([paths.contacts])
  })
})
