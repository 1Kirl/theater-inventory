import { conditionCountsTotal } from '@/domain/inventory'
import { shortageOf } from '@/domain/production'
import type { ConditionCounts } from '@/types/inventory'
import type { ActionStatus, ActionType, ProductionStatus } from '@/types/production'
import type { MaintenanceStatus } from '@/types/maintenance'
import type { ModulePermissions } from '@/types/organization'

/**
 * The QA and demonstration dataset, described but not written.
 *
 * Everything here is plain data with stable local keys — `team:sound`,
 * `item:blx`. The seed script resolves those to real Firestore IDs when it
 * writes; nothing in this module knows about Firebase, which is what lets the
 * shape of the dataset be tested without a network.
 *
 * It is deliberately small. The point is not volume but coverage: every
 * condition, an item with nothing available, items never inspected, a repair
 * that is overdue, a requirement that is genuinely short, and a requirement
 * that matches nothing.
 */

export const DEMO_ORGANIZATION_NAME = 'Ridgeview High School Theater'

/** Local keys. They never reach Firestore; they are how this file cross-references itself. */
export type TeamKey = 'lighting' | 'sound' | 'scenic' | 'props' | 'costumes' | 'stage-management'

export interface DemoTeam {
  key: TeamKey
  name: string
}

export const DEMO_TEAMS: readonly DemoTeam[] = [
  { key: 'lighting', name: 'Lighting' },
  { key: 'sound', name: 'Sound' },
  { key: 'scenic', name: 'Scenic' },
  { key: 'props', name: 'Props' },
  { key: 'costumes', name: 'Costumes' },
  { key: 'stage-management', name: 'Stage Management' },
]

/**
 * What the demo Member is allowed to do.
 *
 * Chosen so a tester can see every axis at once: two teams rather than all six,
 * one module they may edit, one they may only read, and the calendar read-only.
 * Nothing here is special-cased in the application — it is an ordinary
 * membership that an Admin could have assigned.
 */
export const DEMO_MEMBER_TEAMS: readonly TeamKey[] = ['sound', 'lighting']

export const DEMO_MEMBER_PERMISSIONS: ModulePermissions = {
  inventory: 'edit',
  maintenance: 'view',
  productions: 'edit',
  calendar: 'view',
}

export interface DemoInventoryItem {
  key: string
  name: string
  category: string
  team: TeamKey
  quantityTotal: number
  quantityAvailable: number
  conditionCounts: Partial<ConditionCounts>
  location: string
  /** Days before today, or null for an item nobody has ever inspected. */
  inspectedDaysAgo: number | null
  notes?: string
}

export const DEMO_INVENTORY: readonly DemoInventoryItem[] = [
  {
    key: 'item:blx', name: 'Shure BLX Wireless Microphone System', category: 'Microphones',
    team: 'sound', quantityTotal: 12, quantityAvailable: 8,
    conditionCounts: { good: 8, needs_repair: 4 },
    location: 'Sound Storage Cabinet B', inspectedDaysAgo: 45,
    notes: 'Four transmitters have been unreliable since the winter concert.',
  },
  {
    key: 'item:sm58', name: 'Shure SM58 Handheld Microphone', category: 'Microphones',
    team: 'sound', quantityTotal: 6, quantityAvailable: 6,
    conditionCounts: { excellent: 6 },
    location: 'Sound Storage Cabinet B', inspectedDaysAgo: null,
  },
  {
    key: 'item:mixer', name: 'Yamaha MG16XU Mixing Console', category: 'Sound Equipment',
    team: 'sound', quantityTotal: 1, quantityAvailable: 1,
    conditionCounts: { good: 1 },
    location: 'Sound Booth', inspectedDaysAgo: 90,
  },
  {
    key: 'item:speaker', name: 'QSC K12.2 Powered Speaker', category: 'Sound Equipment',
    team: 'sound', quantityTotal: 4, quantityAvailable: 4,
    conditionCounts: { good: 4 },
    location: 'Sound Booth', inspectedDaysAgo: 90,
  },
  {
    key: 'item:xlr', name: 'XLR Cable 25ft', category: 'Cables',
    team: 'sound', quantityTotal: 30, quantityAvailable: 24,
    conditionCounts: { good: 20, fair: 8, needs_repair: 2 },
    location: 'Sound Storage Cabinet A', inspectedDaysAgo: 45,
  },
  {
    key: 'item:dmx', name: 'DMX Cable 50ft', category: 'Cables',
    team: 'lighting', quantityTotal: 20, quantityAvailable: 20,
    conditionCounts: { good: 18, fair: 2 },
    location: 'Lighting Storage A', inspectedDaysAgo: 120,
  },
  {
    key: 'item:s4', name: 'ETC Source Four 26 Degree', category: 'Lighting Instruments',
    team: 'lighting', quantityTotal: 18, quantityAvailable: 14,
    conditionCounts: { excellent: 6, good: 8, needs_repair: 4 },
    location: 'Lighting Storage A', inspectedDaysAgo: 120,
  },
  {
    // Nothing available and every unit unusable: the clearest thing on the
    // shelf that should not be counted on.
    key: 'item:fresnel', name: 'Altman 6 inch Fresnel', category: 'Lighting Instruments',
    team: 'lighting', quantityTotal: 8, quantityAvailable: 0,
    conditionCounts: { unusable: 8 },
    location: 'Lighting Storage B', inspectedDaysAgo: 200,
    notes: 'Lenses crazed and sockets scorched. Kept only for parts.',
  },
  {
    key: 'item:led-par', name: 'LED PAR Can RGBW', category: 'Lighting Instruments',
    team: 'lighting', quantityTotal: 12, quantityAvailable: 10,
    conditionCounts: { good: 12 },
    location: 'Lighting Storage A', inspectedDaysAgo: null,
  },
  {
    key: 'item:gel-frame', name: 'Gel Frame 6.25 inch', category: 'Lighting Accessories',
    team: 'lighting', quantityTotal: 40, quantityAvailable: 40,
    conditionCounts: { good: 40 },
    location: 'Lighting Storage A', inspectedDaysAgo: 120,
  },
  {
    key: 'item:c-clamp', name: 'C-Clamp', category: 'Hardware',
    team: 'lighting', quantityTotal: 24, quantityAvailable: 20,
    conditionCounts: { good: 24 },
    location: 'Lighting Storage B', inspectedDaysAgo: 200,
  },
  {
    key: 'item:drill', name: 'Cordless Drill', category: 'Tools',
    team: 'scenic', quantityTotal: 3, quantityAvailable: 2,
    conditionCounts: { good: 2, needs_repair: 1 },
    location: 'Scene Shop', inspectedDaysAgo: 30,
  },
  {
    key: 'item:platform', name: '4x8 Platform', category: 'Platforms / Flats',
    team: 'scenic', quantityTotal: 10, quantityAvailable: 10,
    conditionCounts: { good: 6, fair: 4 },
    location: 'Scene Shop Loft', inspectedDaysAgo: 60,
  },
  {
    // Condition deliberately unrecorded, so the Unclassified state appears.
    key: 'item:lumber', name: '1x3 Lumber 8ft', category: 'Set-Building Materials',
    team: 'scenic', quantityTotal: 60, quantityAvailable: 45,
    conditionCounts: {},
    location: 'Scene Shop', inspectedDaysAgo: null,
  },
  {
    key: 'item:parlor-chair', name: 'Victorian Parlor Chair', category: 'Props',
    team: 'props', quantityTotal: 4, quantityAvailable: 4,
    conditionCounts: { fair: 4 },
    location: 'Props Loft', inspectedDaysAgo: null,
  },
  {
    key: 'item:gown', name: 'Period Gown, Assorted', category: 'Costumes',
    team: 'costumes', quantityTotal: 15, quantityAvailable: 15,
    conditionCounts: { good: 10, fair: 5 },
    location: 'Costume Loft', inspectedDaysAgo: 150,
  },
  {
    key: 'item:comm', name: 'Wireless Headset Comm Pack', category: 'Miscellaneous Technical Equipment',
    team: 'stage-management', quantityTotal: 6, quantityAvailable: 5,
    conditionCounts: { good: 5, needs_repair: 1 },
    location: 'Sound Booth', inspectedDaysAgo: 75,
  },
]

export interface DemoMaintenanceRecord {
  key: string
  item: string
  quantitySent: number
  issueDescription: string
  status: MaintenanceStatus
  sentDaysAgo?: number
  /** Negative means the date is still ahead; positive means it has passed. */
  expectedReturnDaysAgo?: number
  returnedDaysAgo?: number
  providerName?: string
  cost?: number
  repairNotes?: string
}

export const DEMO_MAINTENANCE: readonly DemoMaintenanceRecord[] = [
  {
    key: 'repair:blx', item: 'item:blx', quantitySent: 4,
    issueDescription: 'Four transmitters drop out intermittently during a run.',
    status: 'planned',
  },
  {
    key: 'repair:s4', item: 'item:s4', quantitySent: 4,
    issueDescription: 'Shutters seized and one socket arcing.',
    status: 'in_service', sentDaysAgo: 10, expectedReturnDaysAgo: -5,
    providerName: 'Northside Stage Service',
  },
  {
    // Expected back five days ago and still out: this is what makes the
    // Dashboard's overdue badge appear.
    key: 'repair:drill', item: 'item:drill', quantitySent: 1,
    issueDescription: 'Chuck slips under load.',
    status: 'sent', sentDaysAgo: 20, expectedReturnDaysAgo: 5,
    providerName: 'Kellerman Tool Repair',
  },
  {
    key: 'repair:xlr', item: 'item:xlr', quantitySent: 2,
    issueDescription: 'Two cables intermittent at the male connector.',
    status: 'returned', sentDaysAgo: 60, expectedReturnDaysAgo: 45, returnedDaysAgo: 40,
    providerName: 'In-house', cost: 0,
    repairNotes: 'Reterminated both ends. Tested on the console.',
  },
]

export interface DemoProduction {
  key: string
  title: string
  description: string
  status: ProductionStatus
  startDaysFromNow?: number
  endDaysFromNow?: number
}

export const DEMO_PRODUCTIONS: readonly DemoProduction[] = [
  {
    key: 'production:musical',
    title: 'Spring Musical — Into the Woods',
    description:
      'School musical in the main auditorium, roughly 200 seats. About 20 vocalists, live'
      + ' pit band, and several set changes. Two rehearsal days before the technical week.',
    status: 'active', startDaysFromNow: 14, endDaysFromNow: 24,
  },
  {
    key: 'production:play',
    title: 'Fall Play — Our Town',
    description: 'Small-cast drama in the black box. Minimal set, five principal actors.',
    status: 'planning', startDaysFromNow: 150, endDaysFromNow: 158,
  },
]

export interface DemoRequirement {
  key: string
  production: string
  itemName: string
  /** The inventory key this is matched to, or null for a Not Matched requirement. */
  item: string | null
  requiredQty: number
  team: TeamKey
  notes?: string
}

export const DEMO_REQUIREMENTS: readonly DemoRequirement[] = [
  {
    // Twenty vocalists against eight available: the shortage the demo is built
    // around. The number is never stored — the app derives it.
    key: 'req:wireless', production: 'production:musical', itemName: 'Wireless Microphones',
    item: 'item:blx', requiredQty: 20, team: 'sound',
    notes: 'One per vocalist. Four of ours are out for repair.',
  },
  {
    key: 'req:handheld', production: 'production:musical', itemName: 'Handheld Microphones',
    item: 'item:sm58', requiredQty: 4, team: 'sound',
    notes: 'Narrator and pit band spots.',
  },
  {
    key: 'req:profiles', production: 'production:musical', itemName: 'Source Four Profiles',
    item: 'item:s4', requiredQty: 24, team: 'lighting',
    notes: 'Front wash plus specials for the two towers.',
  },
  {
    key: 'req:fog', production: 'production:musical', itemName: 'Fog Machine',
    item: null, requiredQty: 1, team: 'lighting',
    notes: 'Nothing in inventory matches. Not Matched until someone links or buys one.',
  },
  {
    key: 'req:platforms', production: 'production:musical', itemName: '4x8 Platforms',
    item: 'item:platform', requiredQty: 8, team: 'scenic',
    notes: 'Two levels for the woods.',
  },
]

export interface DemoActionItem {
  key: string
  requirement: string
  actionType: ActionType
  quantity: number
  status: ActionStatus
  dueDaysFromNow?: number
  notes?: string
}

export const DEMO_ACTIONS: readonly DemoActionItem[] = [
  {
    key: 'action:wireless', requirement: 'req:wireless', actionType: 'rent', quantity: 12,
    status: 'todo', dueDaysFromNow: 7,
    notes: 'Quote requested from Northside. Cheaper than buying for one show.',
  },
  {
    key: 'action:profiles', requirement: 'req:profiles', actionType: 'rent', quantity: 10,
    status: 'in_progress', dueDaysFromNow: 5,
    notes: 'Borrowing from the district equipment pool.',
  },
]

export interface DemoCalendarEvent {
  key: string
  title: string
  eventType: string
  daysFromNow: number
  startTime?: string
  endTime?: string
  /** Empty means the event is for every team. */
  teams: readonly TeamKey[]
  production?: string
  maintenance?: string
  notes?: string
}

export const DEMO_CALENDAR: readonly DemoCalendarEvent[] = [
  {
    key: 'event:build', title: 'Build Day', eventType: 'Build Day', daysFromNow: 3,
    teams: ['scenic', 'props'], production: 'production:musical',
    notes: 'Platforms and the two towers. Bring closed shoes.',
  },
  {
    key: 'event:pickup', title: 'Collect drill from Kellerman', eventType: 'Repair Pickup/Return',
    daysFromNow: 5, startTime: '09:00', teams: ['scenic'], maintenance: 'repair:drill',
  },
  {
    key: 'event:tech', title: 'Tech Rehearsal', eventType: 'Rehearsal', daysFromNow: 7,
    startTime: '18:00', endTime: '21:00', teams: [], production: 'production:musical',
  },
  {
    key: 'event:inspection', title: 'Lighting Inventory Inspection',
    eventType: 'Equipment Inspection', daysFromNow: 10, startTime: '15:30', endTime: '17:00',
    teams: ['lighting'],
    notes: 'Several instruments have no inspection on record.',
  },
  {
    key: 'event:deadline', title: 'Rental returns due', eventType: 'Production Deadline',
    daysFromNow: 14, teams: [], production: 'production:musical',
  },
  {
    key: 'event:opening', title: 'Opening Night', eventType: 'Performance', daysFromNow: 21,
    startTime: '19:00', endTime: '21:30', teams: [], production: 'production:musical',
  },
]

/**
 * A date `days` from the given day, at local midnight.
 *
 * Local parts throughout, for the reason decision 59 records: a UTC round trip
 * moves a date across midnight for anyone east of Greenwich.
 */
export function demoDate(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
}

/** The condition map, filled out to the full five keys. */
export function demoConditionCounts(item: DemoInventoryItem): ConditionCounts {
  return {
    excellent: item.conditionCounts.excellent ?? 0,
    good: item.conditionCounts.good ?? 0,
    fair: item.conditionCounts.fair ?? 0,
    needs_repair: item.conditionCounts.needs_repair ?? 0,
    unusable: item.conditionCounts.unusable ?? 0,
  }
}

export interface DemoShortage {
  requirement: DemoRequirement
  available: number | null
  shortage: number | null
}

/**
 * What the application will derive once this data exists.
 *
 * Not written anywhere — computed here only so the dataset's own tests can
 * assert that the demo actually demonstrates a shortage.
 */
export function demoShortages(): DemoShortage[] {
  return DEMO_REQUIREMENTS.map((requirement) => {
    if (!requirement.item) return { requirement, available: null, shortage: null }

    const item = DEMO_INVENTORY.find((entry) => entry.key === requirement.item)
    if (!item) return { requirement, available: null, shortage: null }

    return {
      requirement,
      available: item.quantityAvailable,
      shortage: shortageOf(requirement.requiredQty, item.quantityAvailable),
    }
  })
}

export interface DemoInventoryCheck {
  item: DemoInventoryItem
  classified: number
  valid: boolean
}

/** Quantities and condition counts the Security Rules will insist on. */
export function checkDemoInventory(): DemoInventoryCheck[] {
  return DEMO_INVENTORY.map((item) => {
    const classified = conditionCountsTotal(demoConditionCounts(item))
    return {
      item,
      classified,
      valid: item.quantityAvailable <= item.quantityTotal && classified <= item.quantityTotal,
    }
  })
}
