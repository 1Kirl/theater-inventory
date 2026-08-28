import { describe, expect, it } from 'vitest'
import {
  DEMO_ACTIONS, DEMO_CALENDAR, DEMO_INVENTORY, DEMO_MAINTENANCE, DEMO_MEMBER_PERMISSIONS,
  DEMO_MEMBER_TEAMS, DEMO_PRODUCTIONS, DEMO_REQUIREMENTS, DEMO_TEAMS, checkDemoInventory,
  demoConditionCounts, demoDate, demoShortages,
} from '@/domain/demo-dataset'
import { INVENTORY_CATEGORIES } from '@/types/inventory'
import { PERMISSION_MODULES } from '@/types/organization'
import { ACTION_STATUSES, ACTION_TYPES, PRODUCTION_STATUSES } from '@/types/production'
import { MAINTENANCE_STATUSES } from '@/types/maintenance'
import { currentlyInService } from '@/domain/maintenance'
import { isOpenAction } from '@/domain/production'
import { isOpenStatus } from '@/domain/maintenance'

/**
 * The demo dataset is data, so it can be wrong quietly.
 *
 * These check the properties the demonstration depends on: that the shortage is
 * real, that every cross-reference resolves, and that nothing here would be
 * refused by the Security Rules once it reaches Firestore.
 */

const TEAM_KEYS = new Set(DEMO_TEAMS.map((team) => team.key))
const ITEM_KEYS = new Set(DEMO_INVENTORY.map((item) => item.key))

describe('identity', () => {
  it('has no duplicate key anywhere in the dataset', () => {
    const keys = [
      ...DEMO_TEAMS.map((entry) => entry.key),
      ...DEMO_INVENTORY.map((entry) => entry.key),
      ...DEMO_MAINTENANCE.map((entry) => entry.key),
      ...DEMO_PRODUCTIONS.map((entry) => entry.key),
      ...DEMO_REQUIREMENTS.map((entry) => entry.key),
      ...DEMO_ACTIONS.map((entry) => entry.key),
      ...DEMO_CALENDAR.map((entry) => entry.key),
    ]

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('carries no Firestore document ID', () => {
    // Keys are local to this file; the seed script mints real IDs when it
    // writes, exactly as the application does.
    const keys = [...ITEM_KEYS, ...TEAM_KEYS]
    expect(keys.every((key) => key.includes(':') || TEAM_KEYS.has(key as never))).toBe(true)
  })
})

describe('teams and the demo member', () => {
  it('has the six teams a theater department actually runs', () => {
    expect(DEMO_TEAMS.map((team) => team.name)).toEqual([
      'Lighting', 'Sound', 'Scenic', 'Props', 'Costumes', 'Stage Management',
    ])
  })

  it('assigns the member a subset, not everything', () => {
    expect(DEMO_MEMBER_TEAMS.every((key) => TEAM_KEYS.has(key))).toBe(true)
    expect(DEMO_MEMBER_TEAMS.length).toBeGreaterThan(0)
    expect(DEMO_MEMBER_TEAMS.length).toBeLessThan(DEMO_TEAMS.length)
  })

  it('gives the member a permission plan that exercises every level worth testing', () => {
    expect(Object.keys(DEMO_MEMBER_PERMISSIONS).sort()).toEqual([...PERMISSION_MODULES].sort())

    const levels = new Set(Object.values(DEMO_MEMBER_PERMISSIONS))
    expect(levels.has('edit')).toBe(true)
    expect(levels.has('view')).toBe(true)
  })

  it('leaves the member with at least one module, so the role computes to member', () => {
    // Decision 13: no team or no permission would compute to unassigned.
    const usable = Object.values(DEMO_MEMBER_PERMISSIONS).filter((level) => level !== 'none')
    expect(usable.length).toBeGreaterThan(0)
  })
})

describe('inventory', () => {
  it('uses only categories the application offers', () => {
    for (const item of DEMO_INVENTORY) {
      expect(INVENTORY_CATEGORIES).toContain(item.category)
    }
  })

  it('assigns every item to a real team', () => {
    for (const item of DEMO_INVENTORY) expect(TEAM_KEYS.has(item.team)).toBe(true)
  })

  it('keeps every quantity within what the Rules accept', () => {
    // available <= total, and classified units <= total.
    for (const check of checkDemoInventory()) {
      expect(check.valid, `${check.item.name} has impossible quantities`).toBe(true)
    }
  })

  it('covers all five conditions', () => {
    const seen = new Set<string>()
    for (const item of DEMO_INVENTORY) {
      for (const [key, count] of Object.entries(demoConditionCounts(item))) {
        if (count > 0) seen.add(key)
      }
    }

    expect([...seen].sort())
      .toEqual(['excellent', 'fair', 'good', 'needs_repair', 'unusable'])
  })

  it('includes something with nothing available', () => {
    expect(DEMO_INVENTORY.some((item) => item.quantityAvailable === 0)).toBe(true)
  })

  it('includes items nobody has ever inspected', () => {
    // "Find equipment with no inspection history" needs something to find.
    const never = DEMO_INVENTORY.filter((item) => item.inspectedDaysAgo === null)
    expect(never.length).toBeGreaterThanOrEqual(3)
  })

  it('includes unusable lighting equipment', () => {
    const unusableLighting = DEMO_INVENTORY.filter(
      (item) => item.team === 'lighting' && (item.conditionCounts.unusable ?? 0) > 0,
    )
    expect(unusableLighting.length).toBeGreaterThan(0)
  })

  it('has fewer microphones available than a twenty-voice cast needs', () => {
    const available = DEMO_INVENTORY
      .filter((item) => item.category === 'Microphones')
      .reduce((sum, item) => sum + item.quantityAvailable, 0)

    expect(available).toBeLessThan(20)
  })

  it('spreads across several teams, categories, and locations', () => {
    expect(new Set(DEMO_INVENTORY.map((item) => item.team)).size).toBeGreaterThanOrEqual(5)
    expect(new Set(DEMO_INVENTORY.map((item) => item.category)).size).toBeGreaterThanOrEqual(8)
    expect(new Set(DEMO_INVENTORY.map((item) => item.location)).size).toBeGreaterThanOrEqual(6)
  })
})

describe('maintenance', () => {
  it('links every record to a real item', () => {
    for (const record of DEMO_MAINTENANCE) expect(ITEM_KEYS.has(record.item)).toBe(true)
  })

  it('uses only canonical statuses', () => {
    for (const record of DEMO_MAINTENANCE) {
      expect(MAINTENANCE_STATUSES).toContain(record.status)
    }
  })

  it('never sends more than the item has', () => {
    // firestore.rules: quantitySent <= the item's quantity_total.
    for (const record of DEMO_MAINTENANCE) {
      const item = DEMO_INVENTORY.find((entry) => entry.key === record.item)
      expect(record.quantitySent).toBeGreaterThan(0)
      expect(record.quantitySent).toBeLessThanOrEqual(item?.quantityTotal ?? 0)
    }
  })

  it('covers planned, out, and returned', () => {
    const statuses = new Set(DEMO_MAINTENANCE.map((record) => record.status))
    expect(statuses.has('planned')).toBe(true)
    expect(statuses.has('returned')).toBe(true)
    expect([...statuses].some((status) => status === 'sent' || status === 'in_service')).toBe(true)
  })

  it('leaves one repair past its expected return, so overdue is demonstrable', () => {
    const overdue = DEMO_MAINTENANCE.filter(
      (record) => record.status !== 'returned' && (record.expectedReturnDaysAgo ?? -1) > 0,
    )
    expect(overdue.length).toBeGreaterThan(0)
  })

  it('produces Dashboard figures that differ from each other', () => {
    // Active Repairs counts jobs; Currently in Service counts units, and a
    // planned repair has not left the building.
    const open = DEMO_MAINTENANCE.filter((record) => isOpenStatus(record.status)).length
    const inService = currentlyInService(
      DEMO_MAINTENANCE.map((record) => ({ status: record.status, quantity_sent: record.quantitySent })),
    )

    expect(open).toBeGreaterThan(0)
    expect(inService).toBeGreaterThan(0)
    expect(open).not.toBe(inService)
  })
})

describe('productions, requirements, and actions', () => {
  const productionKeys = new Set(DEMO_PRODUCTIONS.map((entry) => entry.key))
  const requirementKeys = new Set(DEMO_REQUIREMENTS.map((entry) => entry.key))

  it('uses only canonical production statuses, with one active', () => {
    for (const production of DEMO_PRODUCTIONS) {
      expect(PRODUCTION_STATUSES).toContain(production.status)
    }
    expect(DEMO_PRODUCTIONS.filter((entry) => entry.status === 'active')).toHaveLength(1)
  })

  it('describes the 200-seat, 20-vocalist scenario the QA cases assume', () => {
    const musical = DEMO_PRODUCTIONS.find((entry) => entry.status === 'active')

    expect(musical?.description).toMatch(/200 seats/i)
    expect(musical?.description).toMatch(/20 vocalists/i)
  })

  it('attaches every requirement to a real production and team', () => {
    for (const requirement of DEMO_REQUIREMENTS) {
      expect(productionKeys.has(requirement.production)).toBe(true)
      expect(TEAM_KEYS.has(requirement.team)).toBe(true)
      expect(requirement.requiredQty).toBeGreaterThan(0)
      expect(Number.isInteger(requirement.requiredQty)).toBe(true)
    }
  })

  it('matches requirements only to inventory that exists', () => {
    for (const requirement of DEMO_REQUIREMENTS) {
      if (requirement.item) expect(ITEM_KEYS.has(requirement.item)).toBe(true)
    }
  })

  it('includes a Not Matched requirement', () => {
    expect(DEMO_REQUIREMENTS.some((requirement) => requirement.item === null)).toBe(true)
  })

  it('produces a real shortage the application will derive', () => {
    // Twenty wireless microphones wanted, eight genuinely available.
    const wireless = demoShortages().find((entry) => entry.requirement.key === 'req:wireless')

    expect(wireless?.available).toBe(8)
    expect(wireless?.shortage).toBe(12)
  })

  it('also includes a requirement that is already covered', () => {
    expect(demoShortages().some((entry) => entry.shortage === 0)).toBe(true)
  })

  it('reports no shortage for the unmatched requirement, rather than zero', () => {
    const fog = demoShortages().find((entry) => entry.requirement.key === 'req:fog')

    expect(fog?.available).toBeNull()
    expect(fog?.shortage).toBeNull()
  })

  it('creates actions only for requirements that are matched and short', () => {
    // The same two conditions Security Rules enforce at creation.
    const shortages = new Map(demoShortages().map((entry) => [entry.requirement.key, entry]))

    for (const action of DEMO_ACTIONS) {
      expect(requirementKeys.has(action.requirement)).toBe(true)

      const shortage = shortages.get(action.requirement)
      expect(shortage?.available).not.toBeNull()
      expect(shortage?.shortage ?? 0).toBeGreaterThan(0)
    }
  })

  it('keeps action quantities and statuses within the model', () => {
    for (const action of DEMO_ACTIONS) {
      expect(ACTION_TYPES).toContain(action.actionType)
      expect(ACTION_STATUSES).toContain(action.status)
      expect(action.quantity).toBeGreaterThan(0)
      expect(Number.isInteger(action.quantity)).toBe(true)
    }
  })

  it('leaves unresolved actions for the Dashboard to count', () => {
    expect(DEMO_ACTIONS.filter((action) => isOpenAction(action.status)).length).toBeGreaterThan(0)
  })

  it('gives each requirement at most one action', () => {
    // The Action Item document ID is the requirement ID, so two would collide.
    const requirements = DEMO_ACTIONS.map((action) => action.requirement)
    expect(new Set(requirements).size).toBe(requirements.length)
  })
})

describe('calendar', () => {
  it('is all in the future, so the Dashboard has something upcoming', () => {
    for (const event of DEMO_CALENDAR) expect(event.daysFromNow).toBeGreaterThan(0)
    expect(DEMO_CALENDAR.length).toBeGreaterThanOrEqual(5)
  })

  it('links only to records that exist', () => {
    const productionKeys = new Set(DEMO_PRODUCTIONS.map((entry) => entry.key))
    const repairKeys = new Set(DEMO_MAINTENANCE.map((entry) => entry.key))

    for (const event of DEMO_CALENDAR) {
      if (event.production) expect(productionKeys.has(event.production)).toBe(true)
      if (event.maintenance) expect(repairKeys.has(event.maintenance)).toBe(true)
      for (const team of event.teams) expect(TEAM_KEYS.has(team)).toBe(true)
    }
  })

  it('uses clock times only in pairs that make sense', () => {
    for (const event of DEMO_CALENDAR) {
      if (event.endTime) expect(event.startTime).toBeDefined()
      if (event.startTime && event.endTime) {
        expect(event.endTime >= event.startTime).toBe(true)
      }
    }
  })

  it('mixes all-day items with timed ones', () => {
    expect(DEMO_CALENDAR.some((event) => !event.startTime)).toBe(true)
    expect(DEMO_CALENDAR.some((event) => event.startTime)).toBe(true)
  })
})

describe('demoDate', () => {
  it('builds local midnight, not a UTC instant', () => {
    // Decision 59: a UTC round trip moves the date across midnight.
    const today = new Date(2026, 7, 25, 14, 30)
    const later = demoDate(today, 3)

    expect(later.getFullYear()).toBe(2026)
    expect(later.getMonth()).toBe(7)
    expect(later.getDate()).toBe(28)
    expect(later.getHours()).toBe(0)
  })

  it('crosses month and year boundaries correctly', () => {
    expect(demoDate(new Date(2026, 11, 30), 5).getFullYear()).toBe(2027)
    expect(demoDate(new Date(2026, 11, 30), 5).getMonth()).toBe(0)
    expect(demoDate(new Date(2026, 0, 3), -5).getMonth()).toBe(11)
  })
})
