import type { FieldValue } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { ACTION_TYPE_LABELS, ALREADY_AVAILABLE_LABEL } from '@/domain/production'
import { buildRequirementDocument } from '@/domain/production-payloads'
import { ACTION_TYPES } from '@/types/production'
import {
  canCreateActionItem,
  defaultActionQuantity,
  isOpenAction,
  requirementAvailability,
  shortageOf,
  validateActionQuantity,
  validateRequiredQuantity,
} from '@/domain/production'
import type { InventoryItem } from '@/types/inventory'

const items = [
  { item_id: 'i-mic', quantity_available: 5 },
  { item_id: 'i-cable', quantity_available: 45 },
  { item_id: 'i-none', quantity_available: 0 },
] as InventoryItem[]

function requirement(inventoryItemId: string | undefined, requiredQty: number) {
  return { ...(inventoryItemId ? { inventory_item_id: inventoryItemId } : {}), required_qty: requiredQty }
}

describe('shortageOf', () => {
  it('is the gap when demand exceeds availability', () => {
    expect(shortageOf(10, 7)).toBe(3)
  })

  it('is zero when availability meets demand exactly', () => {
    expect(shortageOf(10, 10)).toBe(0)
  })

  it('is zero, never negative, when there is more than needed', () => {
    expect(shortageOf(10, 12)).toBe(0)
  })
})

describe('requirementAvailability', () => {
  it('reports Not Matched without a linked item', () => {
    expect(requirementAvailability(requirement(undefined, 8), items)).toEqual({ matched: false })
  })

  it('reports Not Matched when the linked item cannot be read', () => {
    expect(requirementAvailability(requirement('i-gone', 8), items)).toEqual({ matched: false })
  })

  it('computes availability and shortage from the linked item', () => {
    expect(requirementAvailability(requirement('i-mic', 8), items)).toEqual({
      matched: true,
      available: 5,
      shortage: 3,
      alreadyAvailable: false,
    })
  })

  it('marks a satisfied requirement as already available', () => {
    expect(requirementAvailability(requirement('i-cable', 30), items)).toEqual({
      matched: true,
      available: 45,
      shortage: 0,
      alreadyAvailable: true,
    })
  })

  it('treats an item with nothing available as matched with a full shortage', () => {
    // Distinct from Not Matched: the organization owns this, none is free.
    expect(requirementAvailability(requirement('i-none', 4), items)).toEqual({
      matched: true,
      available: 0,
      shortage: 4,
      alreadyAvailable: false,
    })
  })

  it('uses quantity_available alone, never subtracting anything else', () => {
    // The worked example from decision 46: total 10, available 7, in service 3,
    // required 8. Availability is 7 and shortage is 1, not 4 and 4.
    const item = [{ item_id: 'i-x', quantity_available: 7 }] as InventoryItem[]
    expect(requirementAvailability(requirement('i-x', 8), item)).toEqual({
      matched: true,
      available: 7,
      shortage: 1,
      alreadyAvailable: false,
    })
  })

  it('follows the linked item live, so a changed availability changes the shortage', () => {
    const before = [{ item_id: 'i-x', quantity_available: 8 }] as InventoryItem[]
    const after = [{ item_id: 'i-x', quantity_available: 5 }] as InventoryItem[]

    expect(requirementAvailability(requirement('i-x', 10), before)).toMatchObject({ shortage: 2 })
    expect(requirementAvailability(requirement('i-x', 10), after)).toMatchObject({ shortage: 5 })
  })
})

describe('canCreateActionItem', () => {
  it('refuses an unmatched requirement, which has no shortage to act on', () => {
    expect(canCreateActionItem({ matched: false })).toBe(false)
  })

  it('refuses a satisfied requirement, which needs no work', () => {
    expect(
      canCreateActionItem({ matched: true, available: 12, shortage: 0, alreadyAvailable: true }),
    ).toBe(false)
  })

  it('allows a real shortage', () => {
    expect(
      canCreateActionItem({ matched: true, available: 5, shortage: 3, alreadyAvailable: false }),
    ).toBe(true)
  })
})

describe('defaultActionQuantity', () => {
  it('starts at the current shortage', () => {
    expect(
      defaultActionQuantity({ matched: true, available: 5, shortage: 3, alreadyAvailable: false }),
    ).toBe(3)
  })

  it('is zero for an unmatched requirement', () => {
    expect(defaultActionQuantity({ matched: false })).toBe(0)
  })

  it('is only a starting point — nothing here resynchronises an existing action', () => {
    // The action quantity records what the crew decided to do. Recomputing the
    // shortage later never rewrites it, which is why this function is used at
    // creation only and takes no existing action as input.
    const atCreation = defaultActionQuantity({
      matched: true,
      available: 5,
      shortage: 3,
      alreadyAvailable: false,
    })
    const laterShortage = shortageOf(8, 2)

    expect(atCreation).toBe(3)
    expect(laterShortage).toBe(6)
    expect(atCreation).not.toBe(laterShortage)
  })
})

describe('validateRequiredQuantity', () => {
  it('accepts a positive whole number', () => {
    expect(validateRequiredQuantity(1).valid).toBe(true)
    expect(validateRequiredQuantity(24).valid).toBe(true)
  })

  it('rejects zero, negatives, and fractions', () => {
    for (const value of [0, -1, 2.5]) {
      expect(validateRequiredQuantity(value).valid, String(value)).toBe(false)
    }
  })
})

describe('validateActionQuantity', () => {
  it('rejects zero and negatives', () => {
    expect(validateActionQuantity(0).valid).toBe(false)
    expect(validateActionQuantity(-2).valid).toBe(false)
  })

  it('accepts a quantity that differs from the shortage', () => {
    // A crew may plan to build three even though four are short.
    expect(validateActionQuantity(3).valid).toBe(true)
  })
})

describe('isOpenAction', () => {
  it('counts work not yet finished', () => {
    expect(isOpenAction('todo')).toBe(true)
    expect(isOpenAction('in_progress')).toBe(true)
  })

  it('excludes finished work', () => {
    expect(isOpenAction('done')).toBe(false)
    expect(isOpenAction('cancelled')).toBe(false)
  })
})

describe('the action plan lives only on the Action Item', () => {
  it('exposes exactly the four things a crew can do', () => {
    expect(ACTION_TYPES).toEqual(['buy', 'rent', 'build', 'repair'])
  })

  it('labels all four and nothing else', () => {
    expect(Object.keys(ACTION_TYPE_LABELS).sort()).toEqual(['build', 'buy', 'rent', 'repair'])
  })

  it('keeps Already Available out of the action types', () => {
    // It is a derived state of a requirement whose shortage is zero, not
    // something anyone does, and nothing persists it.
    expect(ACTION_TYPES).not.toContain('already_available')
    expect(ALREADY_AVAILABLE_LABEL).toBe('Already Available')
  })

  it('leaves no action_type on a requirement payload', () => {
    // A second copy on the requirement could disagree with the Action Item,
    // which is why the field was removed rather than kept in step.
    const payload = buildRequirementDocument({
      requirementId: 'r-1',
      organizationId: 'org-1',
      productionId: 'p-1',
      uid: 'u-1',
      now: () => 'ts' as unknown as FieldValue,
      input: { itemName: 'Wireless Microphone', requiredQty: 8, teamId: 't-sound' },
    })

    expect(payload).not.toHaveProperty('action_type')
    expect(Object.keys(payload).sort()).toEqual([
      'created_at', 'created_by_uid', 'item_name', 'organization_id', 'production_id',
      'required_qty', 'requirement_id', 'source', 'team_id', 'updated_at',
    ])
  })
})
