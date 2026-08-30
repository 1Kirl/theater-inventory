import { describe, expect, it } from 'vitest'
import { navItems } from '@/components/layout/nav-items'
import { paths } from '@/routes/paths'

/**
 * Navigation is a product decision as much as a routing detail, so the parts
 * that were decided rather than derived are pinned here.
 */

describe('sidebar navigation', () => {
  it('has no Team & Members entry', () => {
    // Teams, members, permissions, and administration all live in Organization
    // Settings; a second entry would imply a second place to look.
    expect(navItems.some((item) => item.label.includes('Team'))).toBe(false)
    expect(navItems.some((item) => item.path === paths.team)).toBe(false)
  })

  it('offers organization administration through Organization Settings only', () => {
    const adminEntries = navItems.filter((item) => item.adminOnly)

    expect(adminEntries).toHaveLength(1)
    expect(adminEntries[0]?.path).toBe(paths.organizationSettings)
  })

  it('lists the modules a member works in, each tied to its permission', () => {
    expect(navItems.map((item) => [item.label, item.module ?? null])).toEqual([
      ['Dashboard', null],
      ['Inventory', 'inventory'],
      // The scanner is an inventory tool, so it follows the inventory
      // permission rather than carrying one of its own.
      ['Scan', 'inventory'],
      ['Maintenance', 'maintenance'],
      ['Productions', 'productions'],
      ['Action List', 'productions'],
      ['Calendar', 'calendar'],
      // Knowing who is on your crew is not a module permission. The directory
      // is organization-internal and carries none.
      ['Contacts', null],
      ['Organization Settings', null],
    ])
  })

  it('keeps Dashboard permission-free, because each of its cards carries its own', () => {
    const dashboard = navItems.find((item) => item.path === paths.dashboard)

    expect(dashboard).toBeDefined()
    expect(dashboard?.module).toBeUndefined()
    expect(dashboard?.adminOnly).toBe(false)
  })

  it('keeps the Action List on the productions permission', () => {
    expect(navItems.find((item) => item.path === paths.actionList)?.module).toBe('productions')
  })

  it('keeps the legacy team path, so an old bookmark has somewhere to redirect to', () => {
    expect(paths.team).toBe('/team')
    expect(paths.organizationSettings).toBe('/organization-settings')
  })
})
