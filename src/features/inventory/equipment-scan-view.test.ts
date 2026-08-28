import { describe, expect, it } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { equipmentScanOutcome } from '@/features/inventory/equipment-scan-view'
import type { InventoryUnit } from '@/types/inventory'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function unit(organizationId = ORG_A): InventoryUnit {
  return {
    unit_id: 'unit-1',
    organization_id: organizationId,
    asset_code: 'MIC-001',
    status: 'available',
    condition: 'good',
  } as InventoryUnit
}

/** Everything settled and nothing wrong, unless a test says otherwise. */
function outcomeOf(overrides: Partial<Parameters<typeof equipmentScanOutcome>[0]> = {}) {
  return equipmentScanOutcome({
    unit: unit(ORG_A),
    error: null,
    activeOrganizationId: ORG_A,
    organizationLoading: false,
    ...overrides,
  })
}

const DENIED = new FirebaseError('permission-denied', 'Missing or insufficient permissions.')

describe('opening a scanned label', () => {
  it('shows the equipment when it belongs to the organization already open', () => {
    // The ordinary case, and also the in-app one: clicking through from the
    // item page must land here with no detour.
    expect(outcomeOf()).toEqual({ kind: 'ready', unit: unit(ORG_A) })
  })

  it('waits while the unit is still being read', () => {
    expect(outcomeOf({ unit: undefined }).kind).toBe('resolving')
  })

  it('waits while the browser is still working out which organization is open', () => {
    // Without this the page would compare against a null organization for one
    // paint and accuse an ordinary in-app visit of belonging somewhere else.
    expect(outcomeOf({ organizationLoading: true }).kind).toBe('resolving')
    expect(outcomeOf({ activeOrganizationId: null, organizationLoading: true }).kind)
      .toBe('resolving')
  })

  it('does not wait once the read has already failed', () => {
    // A denial is final. Showing a spinner over it would just delay the answer.
    expect(outcomeOf({ unit: null, error: DENIED, organizationLoading: true }).kind)
      .toBe('unavailable')
  })
})

describe('a label from another of your organizations', () => {
  it('offers to switch rather than claiming the equipment is missing', () => {
    // Reading it succeeded, so Rules already confirmed membership and inventory
    // access there. Refusing at this point would be the interface overruling
    // the authorization boundary.
    const outcome = outcomeOf({ unit: unit(ORG_B) })

    expect(outcome.kind).toBe('other_organization')
    if (outcome.kind === 'other_organization') {
      expect(outcome.organizationId).toBe(ORG_B)
      expect(outcome.hasActiveOrganization).toBe(true)
    }
  })

  it('offers the same switch when no organization is open at all', () => {
    // Signing in leaves nothing active. The destination is still known, so the
    // person should not have to go and find the equipment again.
    const outcome = outcomeOf({ unit: unit(ORG_B), activeOrganizationId: null })

    expect(outcome.kind).toBe('other_organization')
    if (outcome.kind === 'other_organization') {
      expect(outcome.organizationId).toBe(ORG_B)
      // Different wording: there is nothing to switch away from.
      expect(outcome.hasActiveOrganization).toBe(false)
    }
  })

  it('never switches on its own — the outcome only names the organization', () => {
    // The active organization is global state. Anything that changed it here
    // would move every other page the person has open.
    const outcome = outcomeOf({ unit: unit(ORG_B) })
    expect(outcome.kind).not.toBe('ready')
  })

  it('resolves to the equipment once that organization is the active one', () => {
    // What the switch button brings about: same unit, same route, no detour.
    expect(outcomeOf({ unit: unit(ORG_B), activeOrganizationId: ORG_B }))
      .toEqual({ kind: 'ready', unit: unit(ORG_B) })
  })

  it('names only the organization, never the equipment', () => {
    // Everything shown before the switch has to survive the possibility that
    // the person changes their mind and never switches.
    const outcome = outcomeOf({ unit: unit(ORG_B) })
    const shown = JSON.stringify(outcome)

    for (const leak of ['MIC-001', 'available', 'good', 'unit-1']) {
      expect(shown).not.toContain(leak)
    }
  })
})

describe('a label somebody should not be able to open', () => {
  it('says the same thing whether the equipment is denied or absent', () => {
    // Rules deny a read of a document that does not exist, so the client cannot
    // tell the two apart. Saying so with one message is the only honest answer,
    // and it stops a stranger with a scanner from confirming an id is real.
    const refused = outcomeOf({ unit: null, error: DENIED })
    const absent = outcomeOf({ unit: null })

    expect(refused.kind).toBe('unavailable')
    expect(absent.kind).toBe('unavailable')
    if (refused.kind === 'unavailable' && absent.kind === 'unavailable') {
      expect(refused.message).toBe(absent.message)
    }
  })

  it('does not claim the equipment does not exist, which it cannot prove', () => {
    const outcome = outcomeOf({ unit: null, error: DENIED })

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return
    expect(outcome.message).toContain('couldn’t open')
    expect(outcome.message).toContain('may not exist')
    expect(outcome.message).not.toMatch(/does not exist|not found|no such/i)
  })

  it('leaks nothing about the equipment or the organization that owns it', () => {
    const outcome = outcomeOf({ unit: null, error: DENIED })

    expect(outcome.kind).toBe('unavailable')
    if (outcome.kind !== 'unavailable') return

    // No asset code, no organization, no team, no status — and no Firebase.
    for (const leak of ['MIC-001', ORG_A, ORG_B, 'unit-1', 'permission-denied', 'Firebase']) {
      expect(outcome.message).not.toContain(leak)
    }
  })

  it('does not blame the person when the network is the problem', () => {
    // Being offline is not a permission problem, and telling somebody they lack
    // access to their own equipment would send them to their Admin for nothing.
    const outcome = outcomeOf({
      unit: null,
      error: new FirebaseError('unavailable', 'Backend unavailable.'),
    })

    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.message).not.toContain('permission')
      expect(outcome.message).not.toContain('unavailable')
    }
  })

  it('never shows a raw Firebase exception', () => {
    for (const raw of [
      new FirebaseError('resource-exhausted', 'Quota exceeded for project demo-x.'),
      new Error('FIRESTORE (11.0.0) INTERNAL ASSERTION FAILED'),
      'something odd',
    ]) {
      const outcome = outcomeOf({ unit: null, error: raw })

      expect(outcome.kind).toBe('error')
      if (outcome.kind === 'error') {
        expect(outcome.message).not.toContain('FIRESTORE')
        expect(outcome.message).not.toContain('demo-x')
        expect(outcome.message).not.toContain('Quota')
      }
    }
  })

  it('treats a failure as a failure even if a stale unit is still in hand', () => {
    // The page keeps the last unit it loaded. A refresh that is denied must not
    // go on showing it.
    expect(outcomeOf({ error: DENIED }).kind).toBe('unavailable')
  })

  it('does not become readable because the route left the permission guard', () => {
    // The whole risk of the routing change in one test: the only thing that
    // decides whether the unit is shown is whether the read succeeded, and the
    // read is Firestore's decision, not the router's.
    for (const active of [ORG_A, ORG_B, null]) {
      expect(outcomeOf({ unit: null, error: DENIED, activeOrganizationId: active }).kind)
        .toBe('unavailable')
    }
  })
})
