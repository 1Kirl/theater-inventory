import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, type Firestore, type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  buildInventoryItemDocument, buildInventoryItemUpdate,
} from '@/domain/inventory-payloads'
import {
  buildActionItemDocument, buildActionItemUpdate, buildProductionDocument,
  buildRequirementDocument,
} from '@/domain/production-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import { MAX_UNIT_COST_CENTS } from '@/domain/money'
import {
  ADMIN, CODE_A, EDIT_INVENTORY, ORG_A, TEAM_COSTUME, TEAM_LIGHTING, VIEW_INVENTORY,
  assertFails, assertSucceeds, createTestEnvironment, seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Phase 11F: money, as Rules see it.
 *
 * Cost is stored, so Rules validate it — an optional field nobody checked would
 * be a place to write anything at all, and `hasExactly` would happily accept a
 * string, a float, or a negative number as "the cost" once the key was allowed.
 *
 * The bound is $1,000,000.00 per unit. Far above anything a school theater buys,
 * and low enough that a misplaced decimal point is caught here rather than in a
 * production budget.
 *
 * Authorization is unchanged: cost follows the inventory and production
 * permissions that already existed, and this file checks that adding a field did
 * not quietly open a door beside them.
 */

let environment: RulesTestEnvironment

const INVENTORY_VIEWER = 'uid-cost-inv-viewer'
const INVENTORY_EDITOR = 'uid-cost-inv-editor'
const COSTUME_EDITOR = 'uid-cost-costume'
const PROD_VIEWER = 'uid-cost-prod-viewer'
const PROD_EDITOR = 'uid-cost-prod-editor'

/** Seeded, and the requirement's match target. Never written by a test. */
const ITEM = 'itemCOSTAAAAAAAAAAAA'
/** Written by the tests, so every write is a create with a fresh `created_at`. */
const NEW_ITEM = 'itemCOSTNEWBBBBBBBBB'
const PROD = 'prodCOSTAAAAAAAAAAAA'
const REQ = 'reqCOSTAAAAAAAAAAAA1'

const VIEW_PROD = {
  inventory: 'view', maintenance: 'none', productions: 'view', calendar: 'none',
} as const
const EDIT_PROD = {
  inventory: 'view', maintenance: 'none', productions: 'edit', calendar: 'none',
} as const

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

/**
 * The payload the application sends, with the cost swapped for what a test needs.
 *
 * Authored by whoever writes it: Rules require `created_by_uid == uid()` on
 * create, so a document built for one user and sent by another is denied for a
 * reason that has nothing to do with cost.
 */
function itemWithCost(cost: unknown, uid: string = ADMIN) {
  const document: Record<string, unknown> = buildInventoryItemDocument({
    itemId: NEW_ITEM,
    organizationId: ORG_A,
    uid,
    now: serverTimestamp,
    input: {
      name: 'Wireless Handheld',
      category: 'Microphones',
      teamId: TEAM_LIGHTING,
      quantityTotal: 4,
      quantityAvailable: 4,
      conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 4 },
      location: 'Booth',
    },
  })

  if (cost === undefined) return document
  return { ...document, unit_cost_cents: cost }
}

function actionWithCost(cost: unknown, uid: string = PROD_EDITOR) {
  const document: Record<string, unknown> = buildActionItemDocument({
    requirementId: REQ,
    organizationId: ORG_A,
    productionId: PROD,
    itemName: 'Wireless Handheld',
    teamId: TEAM_LIGHTING,
    uid,
    now: serverTimestamp,
    input: { actionType: 'buy', quantity: 3, status: 'todo' },
  })

  if (cost === undefined) return document
  return { ...document, estimated_unit_cost_cents: cost }
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Sound' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: INVENTORY_VIEWER, teamIds: [TEAM_LIGHTING],
    permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: INVENTORY_EDITOR, teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: PROD_VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_PROD,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: PROD_EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_PROD,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'inventory_items', ITEM), buildInventoryItemDocument({
      itemId: ITEM, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: {
        name: 'Wireless Handheld',
        category: 'Microphones',
        teamId: TEAM_LIGHTING,
        quantityTotal: 1,
        quantityAvailable: 1,
        conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 1 },
        location: 'Booth',
      },
    }))
    await setDoc(doc(store, 'productions', PROD), buildProductionDocument({
      productionId: PROD, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: { title: 'Spring Musical', status: 'planning' },
    }))
    await setDoc(doc(store, 'production_requirements', REQ), buildRequirementDocument({
      requirementId: REQ, organizationId: ORG_A, productionId: PROD, uid: ADMIN,
      now: serverTimestamp,
      input: {
        itemName: 'Wireless Handheld',
        // Matched and short — 3 required against 1 available — because Rules
        // only allow creating an action for a requirement that needs one.
        inventoryItemId: ITEM,
        requiredQty: 3,
        teamId: TEAM_LIGHTING,
      },
    }))
  })
})

describe('an inventory item that records what it costs', () => {
  it('accepts a whole number of cents from an editor of the owning team', async () => {
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM),
      itemWithCost(24900, INVENTORY_EDITOR)))
  })

  it('accepts one from the Admin', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), itemWithCost(1850)))
  })

  it('accepts zero, which is a decision rather than a gap', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), itemWithCost(0)))
  })

  it('accepts the largest allowed amount', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM),
      itemWithCost(MAX_UNIT_COST_CENTS)))
  })

  it('accepts an item with no cost at all, which is most of an existing catalog', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), itemWithCost(undefined)))
  })

  it.each([
    ['a negative amount', -1],
    ['a large negative amount', -24900],
    ['a fractional cent', 1850.5],
    ['dollars rather than cents, with a fraction', 249.99],
    ['a string', '1850'],
    ['a formatted string', '$18.50'],
    ['a boolean', true],
    ['null', null],
    ['a list', [1850]],
    ['a map', { cents: 1850 }],
    ['far above the maximum', 999_999_999_999],
  ])('refuses %s', async (_label, cost) => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), itemWithCost(cost)))
  })

  it('does not let a viewer set a cost', async () => {
    // Cost follows the inventory permission that already existed. Adding a
    // field must not add a way around it.
    await assertFails(setDoc(doc(db(INVENTORY_VIEWER), 'inventory_items', NEW_ITEM),
      itemWithCost(24900, INVENTORY_VIEWER)))
  })

  it('does not let an editor of another team set a cost on this item', async () => {
    await assertFails(setDoc(doc(db(COSTUME_EDITOR), 'inventory_items', NEW_ITEM),
      itemWithCost(24900, COSTUME_EDITOR)))
  })

  it('lets an authorized editor clear a cost that was recorded', async () => {
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM),
      itemWithCost(24900, INVENTORY_EDITOR)))

    let createdAt = null as unknown as Timestamp
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_items', NEW_ITEM))
      createdAt = (snapshot.data() as { created_at: Timestamp }).created_at
    })

    // An edit replaces the whole document, so omitting the field removes it —
    // which is how "we no longer know what this costs" is expressed. Authorship
    // and creation time carry through, as Rules require on update.
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM),
      buildInventoryItemUpdate({
        itemId: NEW_ITEM,
        organizationId: ORG_A,
        createdByUid: INVENTORY_EDITOR,
        createdAt,
        now: serverTimestamp,
        input: {
          name: 'Wireless Handheld',
          category: 'Microphones',
          teamId: TEAM_LIGHTING,
          quantityTotal: 4,
          quantityAvailable: 4,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 4 },
          location: 'Booth',
        },
      })))
  })
})

describe('an action item that records what it is expected to cost', () => {
  it('accepts a whole number of cents from a production editor', async () => {
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ),
      actionWithCost(1850)))
  })

  it('accepts zero', async () => {
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), actionWithCost(0)))
  })

  it('accepts an action with no estimate, which is the ordinary starting state', async () => {
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ),
      actionWithCost(undefined)))
  })

  it('accepts the largest allowed amount', async () => {
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ),
      actionWithCost(MAX_UNIT_COST_CENTS)))
  })

  it.each([
    ['a negative amount', -1],
    ['dollars as a float', 18.5],
    ['a string', '1850'],
    ['a boolean', false],
    ['null', null],
    ['a list', [1850]],
    ['one cent above the maximum', MAX_UNIT_COST_CENTS + 1],
  ])('refuses %s', async (_label, cost) => {
    await assertFails(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), actionWithCost(cost)))
  })

  it('does not let a production viewer write an estimate', async () => {
    await assertFails(setDoc(doc(db(PROD_VIEWER), 'action_items', REQ),
      actionWithCost(1850, PROD_VIEWER)))
  })

  it('does not let somebody without production access write one', async () => {
    // The inventory editor may price the shelf; that is not permission to plan
    // a production's budget.
    await assertFails(setDoc(doc(db(INVENTORY_EDITOR), 'action_items', REQ),
      actionWithCost(1850, INVENTORY_EDITOR)))
  })
})

describe('what recording a cost must not become', () => {
  it('is not a way to smuggle an unknown field past the schema', async () => {
    const document = { ...itemWithCost(1850), total_cost_cents: 999 }
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), document))
  })

  it('is not a way to store a production total that could drift', async () => {
    const document = { ...actionWithCost(1850), estimated_total_cost_cents: 5550 }
    await assertFails(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), document))
  })

  it('leaves the quantity rules exactly as they were', async () => {
    const zeroQuantity = {
      ...actionWithCost(1850),
      quantity: 0,
    }
    await assertFails(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), zeroQuantity))
  })

  it('does not change what an item without a cost is allowed to be', async () => {
    // The regression that matters most: every existing document has no cost
    // field, and all of them must keep working untouched.
    const legacy = itemWithCost(undefined, INVENTORY_EDITOR)
    expect('unit_cost_cents' in legacy).toBe(false)
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM), legacy))
  })
})

describe('the Phase 11E client, which sends no cost fields at all', () => {
  /**
   * Rules are published before the new client is deployed, so for a while the
   * only client in production is one that has never heard of cost. Every write
   * it makes must still be accepted.
   *
   * The mechanism is that both checks are guarded — `!('field' in data) || ...`
   * — so a payload without the field short-circuits to true, and the field was
   * added to `hasExactly`'s optional list rather than its required one. These
   * tests are what says that is actually true.
   */
  async function storedCreation(collection: string, id: string) {
    let stored = { created_at: null as unknown as Timestamp, created_by_uid: '' }
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, collection, id))
      stored = snapshot.data() as { created_at: Timestamp; created_by_uid: string }
    })
    return stored
  }

  it('A. creates an inventory item with no cost field', async () => {
    const payload = itemWithCost(undefined, INVENTORY_EDITOR)
    expect('unit_cost_cents' in payload).toBe(false)
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM), payload))
  })

  it('B. updates an inventory item that has no cost field, still without one', async () => {
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM),
      itemWithCost(undefined, INVENTORY_EDITOR)))

    const stored = await storedCreation('inventory_items', NEW_ITEM)
    const update: Record<string, unknown> = buildInventoryItemUpdate({
      itemId: NEW_ITEM,
      organizationId: ORG_A,
      createdByUid: stored.created_by_uid,
      createdAt: stored.created_at,
      now: serverTimestamp,
      input: {
        name: 'Wireless Handheld B',
        category: 'Microphones',
        teamId: TEAM_LIGHTING,
        quantityTotal: 6,
        quantityAvailable: 5,
        conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 6 },
        location: 'Booth',
      },
    })

    expect('unit_cost_cents' in update).toBe(false)
    await assertSucceeds(setDoc(doc(db(INVENTORY_EDITOR), 'inventory_items', NEW_ITEM), update))
  })

  it('C. creates an action item with no estimate field', async () => {
    const payload = actionWithCost(undefined, PROD_EDITOR)
    expect('estimated_unit_cost_cents' in payload).toBe(false)
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), payload))
  })

  it('D. updates an action item that has no estimate, still without one', async () => {
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ),
      actionWithCost(undefined, PROD_EDITOR)))

    const stored = await storedCreation('action_items', REQ)
    const update: Record<string, unknown> = buildActionItemUpdate({
      requirementId: REQ,
      organizationId: ORG_A,
      productionId: PROD,
      itemName: 'Wireless Handheld',
      teamId: TEAM_LIGHTING,
      createdByUid: stored.created_by_uid,
      createdAt: stored.created_at,
      now: serverTimestamp,
      // The status change an existing client makes every day.
      input: { actionType: 'buy', quantity: 3, status: 'in_progress' },
    })

    expect('estimated_unit_cost_cents' in update).toBe(false)
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), update))
  })

  it('does not require the new fields on any path', async () => {
    // Stated once, plainly: nothing about cost is mandatory anywhere.
    const item = itemWithCost(undefined, ADMIN)
    const action = actionWithCost(undefined, PROD_EDITOR)

    expect(Object.keys(item)).not.toContain('unit_cost_cents')
    expect(Object.keys(action)).not.toContain('estimated_unit_cost_cents')
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), item))
    await assertSucceeds(setDoc(doc(db(PROD_EDITOR), 'action_items', REQ), action))
  })
})
