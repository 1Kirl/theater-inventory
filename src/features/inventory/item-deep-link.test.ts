import { describe, expect, it } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { resolveDeepLink } from '@/features/inventory/record-deep-link'
import { equipmentScanOutcome } from '@/features/inventory/equipment-scan-view'
import { parseAppQr } from '@/domain/equipment-qr'
import { inventoryItemQrUrl } from '@/domain/equipment-links'
import { isValidElement, type ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { routes } from '@/routes/routes'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'

/**
 * Opening an item from its printed label.
 *
 * Bulk items got QR labels in Phase 11I, and for one release they behaved
 * differently from unit labels across organizations: `/inventory/:itemId` sat
 * inside `OrganizationGuard`, so its guards were evaluated against whichever
 * organization the browser had open rather than the one that owns the item.
 * Somebody with inventory access in A, browsing B, was refused a record A had
 * already authorized — while the same person scanning a *unit* label from A was
 * offered a switch.
 *
 * Two label types with different cross-organization behavior is the worst
 * outcome for a QR workflow, because the person holding the sticker cannot tell
 * which kind they are holding. So the item route joined the unit route outside
 * the guards, and both now resolve through `resolveDeepLink`.
 *
 * What that shifts is *where* the boundary is enforced, not whether it is.
 * Security Rules were not touched: they gate every read on the record's own
 * `organization_id`, so a successful read already proves membership and
 * inventory access in the owning organization. These tests pin the render
 * boundary that sits in front of that.
 */

const ORG_A = 'orgAAAAAAAAAAAAAAAAA'
const ORG_B = 'orgBBBBBBBBBBBBBBBBB'
const ITEM_ID = 'itemDEEPLINKAAAAAAA1'

const UNAVAILABLE = 'We couldn’t open this inventory item. '
  + 'It may not exist, or it may belong to an organization you do not have access to.'

function item(organizationId = ORG_A): InventoryItem {
  return {
    item_id: ITEM_ID,
    organization_id: organizationId,
    name: 'Cannon XLR Cable',
    category: 'Cables',
    team_id: 'team-sound',
    tracking_mode: 'bulk',
    quantity_total: 20,
    quantity_available: 20,
    location: 'Cable rack',
  } as unknown as InventoryItem
}

function resolve(o: {
  record?: InventoryItem | null | undefined
  error?: unknown
  activeOrganizationId?: string | null
  organizationLoading?: boolean
} = {}) {
  return resolveDeepLink({
    record: 'record' in o ? o.record : item(),
    error: o.error ?? null,
    activeOrganizationId: o.activeOrganizationId === undefined ? ORG_A : o.activeOrganizationId,
    organizationLoading: o.organizationLoading ?? false,
    unavailableMessage: UNAVAILABLE,
  })
}

const denied = () => new FirebaseError('permission-denied', 'Missing or insufficient permissions.')

/** The guards one path is nested inside, by name. */
function guardNamesFor(target: string): string[] {
  function walk(nodes: readonly RouteObject[], enclosing: string[]): string[] | null {
    for (const node of nodes) {
      const element: unknown = node.element
      const guards = isValidElement(element)
        ? [...enclosing, ((element as ReactElement).type as { name?: string }).name ?? '']
        : enclosing

      if (node.path === target) return guards
      const found = node.children ? walk(node.children, guards) : null
      if (found) return found
    }
    return null
  }

  const found = walk(routes, [])
  expect(found, `no route configured for ${target}`).not.toBeNull()
  return found ?? []
}

describe('1. the item is in the organization already open', () => {
  it('opens it', () => {
    const outcome = resolve()

    expect(outcome.kind).toBe('ready')
    expect(outcome.kind === 'ready' ? outcome.record.item_id : null).toBe(ITEM_ID)
  })

  it('waits rather than deciding while the organization is still resolving', () => {
    expect(resolve({ organizationLoading: true }).kind).toBe('resolving')
  })

  it('waits while the item itself is still being read', () => {
    expect(resolve({ record: undefined }).kind).toBe('resolving')
  })
})

describe('2. the item belongs to another organization the reader may use', () => {
  const outcome = resolve({ record: item(ORG_B), activeOrganizationId: ORG_A })

  it('does not report it as ready, so no detail is rendered', () => {
    expect(outcome.kind).toBe('other_organization')
    expect(outcome.kind === 'ready').toBe(false)
  })

  it('names the organization to switch to, and offers the switch explicitly', () => {
    expect(outcome).toEqual({
      kind: 'other_organization',
      organizationId: ORG_B,
      hasActiveOrganization: true,
    })
  })

  it('carries nothing about the item itself in the outcome', () => {
    // The whole record is deliberately absent from this branch: whatever the
    // notice renders, it cannot accidentally show a name it was never given.
    expect(JSON.stringify(outcome)).not.toContain('Cannon XLR Cable')
    expect(JSON.stringify(outcome)).not.toContain(ITEM_ID)
  })
})

describe('3. after the switch is confirmed', () => {
  it('opens the item once the active organization matches', () => {
    // Nothing navigates on switch: the route stays where the label pointed and
    // the page re-resolves, which is exactly this call with the new value.
    const after = resolve({ record: item(ORG_B), activeOrganizationId: ORG_B })

    expect(after.kind).toBe('ready')
    expect(after.kind === 'ready' ? after.record.organization_id : null).toBe(ORG_B)
  })

  it('opens the owning organization directly when none was open', () => {
    // Signing out clears the stored organization, so somebody who scans a label,
    // signs in, and lands here has none. There is nothing to move and nobody to
    // surprise, so the notice activates it rather than asking a question with
    // one answer.
    const outcome = resolve({ record: item(ORG_B), activeOrganizationId: null })

    expect(outcome).toEqual({
      kind: 'other_organization',
      organizationId: ORG_B,
      hasActiveOrganization: false,
    })
  })
})

/**
 * 4, 5, 6. Denied is denied, whatever the reason.
 *
 * Rules refuse the read for an outsider, for an unassigned member, and for a
 * member without inventory — and the client cannot tell those apart, because
 * Firestore denies a read of a document that does not exist by the same
 * mechanism. One message for all of them is the only truthful answer, and it is
 * also what stops somebody probing printed labels from confirming which ids are
 * real.
 */
describe('4-6. the reader may not have the item', () => {
  // One assertion rather than three, because there is one code path: an
  // outsider, an unassigned member, and a member without inventory all arrive
  // here as the same permission-denied from Rules. Three copies of this would
  // look like three cases while testing one.
  it('says only that it is unavailable, whichever refusal it was', () => {
    const outcome = resolve({ error: denied(), record: undefined })

    expect(outcome).toEqual({ kind: 'unavailable', message: UNAVAILABLE })
  })

  it('leaks no item name, id, organization, or existence', () => {
    const outcome = resolve({ error: denied(), record: undefined })
    const serialized = JSON.stringify(outcome)

    for (const secret of ['Cannon XLR Cable', ITEM_ID, ORG_A, ORG_B, 'Cable rack', 'team-sound']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('does not distinguish denied from absent', () => {
    expect(resolve({ error: denied(), record: undefined }))
      .toEqual(resolve({ record: null }))
  })
})

describe('7. signed out', () => {
  it('leaves the item deep link under the authentication guard', () => {
    // The route change removed the organization guards and nothing else. An
    // anonymous visit still meets AuthGuard, which redirects to sign-in keeping
    // the destination, so the label finishes its journey after logging in.
    expect(guardNamesFor('/inventory/:itemId')).toContain('AuthGuard')
  })

  it('is not behind the guards that were evaluating the wrong organization', () => {
    // The defect itself: OrganizationGuard and PermissionGuard both judge the
    // *active* organization, so leaving them here refused a record the owning
    // organization had already authorized. Asserted in this file as well as in
    // routes.test.tsx, because this is the file that explains why.
    const guards = guardNamesFor('/inventory/:itemId')

    expect(guards).not.toContain('OrganizationGuard')
    expect(guards).not.toContain('PermissionGuard')
    expect(guards).toEqual(guardNamesFor('/equipment/:unitId'))
  })

  it('did not take the organization guards off any other inventory route', () => {
    expect(guardNamesFor('/inventory/:itemId/edit')).toContain('OrganizationGuard')
    expect(guardNamesFor('/inventory/:itemId/edit')).toContain('PermissionGuard')
  })

  it('never reports ready without a record, whatever the caller passes', () => {
    expect(resolve({ record: null, activeOrganizationId: null }).kind).toBe('unavailable')
    expect(resolve({ record: undefined, activeOrganizationId: null }).kind).toBe('resolving')
  })
})

describe('8. the item does not exist', () => {
  it('reports the same unavailable state as a refusal', () => {
    expect(resolve({ record: null })).toEqual({ kind: 'unavailable', message: UNAVAILABLE })
  })

  it('reports something other than a refusal when the network failed', () => {
    // Offline is not a permission answer and must not read as one, or somebody
    // on a bad connection is told they have lost access.
    const outcome = resolve({ error: new Error('offline'), record: undefined })

    expect(outcome.kind).toBe('error')
    expect(outcome.kind === 'error' ? outcome.message : '').not.toBe(UNAVAILABLE)
  })
})

describe('9. the unit deep link is unchanged', () => {
  const unit = { unit_id: 'u1', organization_id: ORG_A } as unknown as InventoryUnit

  function unitOutcome(o: { activeOrganizationId?: string | null; error?: unknown } = {}) {
    return equipmentScanOutcome({
      unit: o.error ? undefined : unit,
      error: o.error ?? null,
      activeOrganizationId: o.activeOrganizationId === undefined ? ORG_A : o.activeOrganizationId,
      organizationLoading: false,
    })
  }

  it('still reports `unit` rather than `record` when ready', () => {
    const outcome = unitOutcome()
    expect(outcome).toEqual({ kind: 'ready', unit })
  })

  it('still offers a switch across organizations', () => {
    expect(unitOutcome({ activeOrganizationId: ORG_B })).toEqual({
      kind: 'other_organization',
      organizationId: ORG_A,
      hasActiveOrganization: true,
    })
  })

  it('still uses the equipment wording, not the item wording', () => {
    const outcome = unitOutcome({ error: denied() })

    expect(outcome.kind).toBe('unavailable')
    expect(outcome.kind === 'unavailable' ? outcome.message : '').toContain('this equipment')
    expect(outcome.kind === 'unavailable' ? outcome.message : '').not.toBe(UNAVAILABLE)
  })
})

describe('10. the scanner sends people to the same place', () => {
  it('parses an item label to the id the deep-link route takes', () => {
    const parsed = parseAppQr(inventoryItemQrUrl(ITEM_ID))

    expect(parsed).toEqual({ kind: 'item', itemId: ITEM_ID })
  })

  it('builds the destination the scanner links to, which is the deep-link route', () => {
    // The scanner's "Open item" goes to /inventory/{id}. That is the same URL a
    // phone camera opens from the printed label, so both take the flow above
    // rather than the scanner having a private path.
    expect(inventoryItemQrUrl(ITEM_ID)).toContain(`/inventory/${ITEM_ID}`)
  })
})
