import { describe, expect, it } from 'vitest'
import { activeNavPath, isNavItemActive } from '@/components/layout/active-nav'
import { navItems } from '@/components/layout/nav-items'
import { paths } from '@/routes/paths'

/** Every destination the bar offers, in the order it offers them. */
const ALL = navItems.map((item) => item.path)

/** The labels lit for a URL. The whole contract is that this is never plural. */
function activeLabels(pathname: string): string[] {
  return navItems
    .filter((item) => isNavItemActive(item.path, pathname, ALL))
    .map((item) => item.label)
}

describe('exactly one entry is ever active', () => {
  it('1. Calendar, on the calendar', () => {
    expect(activeLabels(paths.calendar)).toEqual(['Calendar'])
  })

  it('2. Inventory, on the inventory list', () => {
    expect(activeLabels(paths.inventory)).toEqual(['Inventory'])
  })

  it('3. Scan, on the scanner — and Inventory is not also lit', () => {
    // The defect: /inventory/scan sits under /inventory, so prefix matching lit
    // both. The scanner is a destination of its own, not a page within the list.
    expect(activeLabels(paths.scanner)).toEqual(['Scan'])
  })

  it('4. Dashboard, at the root', () => {
    expect(activeLabels(paths.dashboard)).toEqual(['Dashboard'])
  })

  it('5. no URL lights two entries', () => {
    const urls = [
      paths.dashboard, paths.inventory, paths.scanner, paths.inventoryNew,
      paths.maintenance, paths.productions, paths.actionList, paths.calendar,
      paths.contacts, paths.organizationSettings,
      paths.inventoryItem('item-1'), paths.inventoryItemEdit('item-1'),
      paths.inventoryUnit('unit-1'), paths.maintenanceRecord('rec-1'),
      paths.production('prod-1'), '/inventory/scan/', '/unknown/place',
    ]

    for (const url of urls) {
      expect(activeLabels(url).length).toBeLessThanOrEqual(1)
    }
  })
})

describe('navigating between destinations', () => {
  it('6. Calendar then Scan leaves Scan alone', () => {
    expect(activeLabels(paths.calendar)).toEqual(['Calendar'])
    expect(activeLabels(paths.scanner)).toEqual(['Scan'])
  })

  it('7. Inventory then Scan leaves Scan alone', () => {
    expect(activeLabels(paths.inventory)).toEqual(['Inventory'])
    expect(activeLabels(paths.scanner)).toEqual(['Scan'])
  })

  it('8. Scan then Inventory leaves Inventory alone', () => {
    expect(activeLabels(paths.scanner)).toEqual(['Scan'])
    expect(activeLabels(paths.inventory)).toEqual(['Inventory'])
  })
})

describe('inventory pages still belong to Inventory', () => {
  it('9. an item detail route keeps Inventory lit', () => {
    expect(activeLabels(paths.inventoryItem('abc123'))).toEqual(['Inventory'])
  })

  it('10. an item edit route keeps Inventory lit', () => {
    expect(activeLabels(paths.inventoryItemEdit('abc123'))).toEqual(['Inventory'])
  })

  it('11. the new-item route keeps Inventory lit', () => {
    expect(activeLabels(paths.inventoryNew)).toEqual(['Inventory'])
  })

  it('12. only the scanner is excepted, not every nested inventory route', () => {
    const nested = ['/inventory/abc', '/inventory/abc/edit', '/inventory/new']
    for (const url of nested) expect(activeLabels(url)).toEqual(['Inventory'])
  })
})

describe('equipment deep links keep their existing behaviour', () => {
  it('13. Equipment Unit Detail lights nothing, as it did before this fix', () => {
    // It lives at /equipment/:unitId, outside the module routes on purpose: a
    // scanned label may belong to an organization other than the active one.
    // No entry claimed it before and none does now — this pins that, rather
    // than changing it.
    expect(paths.inventoryUnit('unit-1')).toBe('/equipment/unit-1')
    expect(activeLabels(paths.inventoryUnit('unit-1'))).toEqual([])
  })
})

describe('the resolver itself', () => {
  it('14. returns the most specific match', () => {
    expect(activeNavPath('/inventory/scan', ['/inventory', '/inventory/scan']))
      .toBe('/inventory/scan')
  })

  it('15. is not affected by the order entries are listed in', () => {
    expect(activeNavPath('/inventory/scan', ['/inventory/scan', '/inventory']))
      .toBe('/inventory/scan')
  })

  it('16. matches whole segments, not string prefixes', () => {
    // /inventory must not claim /inventory-archive.
    expect(activeNavPath('/inventory-archive', ['/inventory'])).toBeNull()
  })

  it('17. the root matches only itself', () => {
    expect(activeNavPath('/calendar', ['/'])).toBeNull()
    expect(activeNavPath('/', ['/'])).toBe('/')
  })

  it('18. ignores a trailing slash', () => {
    expect(activeNavPath('/inventory/scan/', ['/inventory', '/inventory/scan']))
      .toBe('/inventory/scan')
    expect(activeNavPath('/inventory/', ['/inventory'])).toBe('/inventory')
  })

  it('19. ignores a query string or hash', () => {
    expect(activeNavPath('/calendar?new=1', ['/calendar'])).toBe('/calendar')
    expect(activeNavPath('/calendar#top', ['/calendar'])).toBe('/calendar')
  })

  it('20. returns null when nothing claims the URL', () => {
    expect(activeNavPath('/somewhere-else', ALL)).toBeNull()
  })

  it('21. resolves at most one path for any candidate set', () => {
    const resolved = activeNavPath('/inventory/scan', ALL)
    expect(ALL.filter((path) => path === resolved)).toHaveLength(1)
  })
})

describe('desktop and mobile cannot disagree', () => {
  it('22. one resolver serves both, so the same URL gives the same answer', () => {
    // SidebarNav is the only component that renders navItems, and AppShell uses
    // it for the desktop sidebar and the mobile sheet alike. A second matcher
    // is what this test exists to prevent.
    for (const url of [paths.inventory, paths.scanner, paths.calendar]) {
      expect(activeNavPath(url, ALL)).toBe(activeNavPath(url, ALL))
      expect(activeLabels(url)).toHaveLength(1)
    }
  })
})
