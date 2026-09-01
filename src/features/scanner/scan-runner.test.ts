import { describe, expect, it, vi } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { createScanRunner, type ScanContext } from '@/features/scanner/scan-runner'
import { equipmentQrUrl, inventoryItemQrUrl } from '@/domain/equipment-links'
import type { LifecycleAction } from '@/services/unit-lifecycle-service'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'

const ORG = 'org-a'

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'u1',
    organization_id: ORG,
    inventory_item_id: 'item-1',
    asset_code: 'MIC-001',
    team_id: 'team-sound',
    status: 'available',
    condition: 'good',
    ...overrides,
  } as InventoryUnit
}

/** A runner wired to fakes, plus the handles a test needs to steer them. */
function harness(options: {
  units?: Record<string, InventoryUnit>
  context?: Partial<ScanContext>
  perform?: (action: LifecycleAction) => Promise<void>
  readUnit?: (unitId: string) => Promise<InventoryUnit | null>
} = {}) {
  const units = options.units ?? { u1: unit() }
  const performed: LifecycleAction[] = []

  // Recorded in one place only, so a count means what it says.
  const perform = options.perform ?? (async () => {})

  const runner = createScanRunner({
    initialMode: 'inspect',
    getContext: () => ({
      activeOrganizationId: ORG,
      usingTeamId: 'team-sound',
      usingMemberUid: null,
      ...options.context,
    }),
    deps: {
      readUnit: options.readUnit ?? (async (id) => units[id] ?? null),
      readItem: async (): Promise<InventoryItem | null> => (
        { name: 'Wireless Handheld' } as InventoryItem
      ),
      perform: async (action) => {
        performed.push(action)
        await perform(action)
      },
      now: () => 1,
    },
  })

  return {
    runner,
    performed,
    qr: (id: string) => equipmentQrUrl(id),
    itemQr: (id: string) => inventoryItemQrUrl(id),
  }
}

/** Lets every pending promise settle. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('pointing the camera at something that is not ours', () => {
  it('says so and records nothing', () => {
    const { runner } = harness()

    const rejection = runner.handleDecoded('https://example.com/equipment/u1')
    expect(rejection?.kind).toBe('invalid_qr')
    expect(rejection?.message).toContain('not a Theater Inventory label')
    expect(runner.getSession().entries).toHaveLength(0)
  })

  it.each([
    'hello world',
    '',
    'WIFI:S:x;;',
    // Was refused outright until item labels existed. It is now a recognised
    // label — the case below asserts the new answer — so it moved out of this
    // list rather than being deleted from the suite.
    'https://theater-inventory.web.app/productions/p1',
    'https://theater-inventory.web.app/inventory/i1/edit',
    'https://theater-inventory.web.app/inventory',
  ])(
    'refuses %s without touching the session',
    (value) => {
      const { runner } = harness()
      expect(runner.handleDecoded(value)?.kind).toBe('invalid_qr')
      expect(runner.getSession().entries).toHaveLength(0)
    },
  )

  it('now reads /inventory/{id} as an item label instead of refusing it', () => {
    const { runner } = harness()

    const outcome = runner.handleDecoded('https://theater-inventory.web.app/inventory/i1')

    expect(outcome?.kind).toBe('item')
    expect(runner.getSession().entries).toHaveLength(0)
  })
})

describe('the same code sitting in front of the lens', () => {
  it('is admitted once and rejected thereafter', async () => {
    const { runner, qr } = harness()

    expect(runner.handleDecoded(qr('u1'))).toBeNull()
    await settle()

    for (let i = 0; i < 10; i += 1) {
      const rejection = runner.handleDecoded(qr('u1'))
      expect(rejection?.kind).toBe('duplicate')
      expect(rejection?.message).toContain('MIC-001')
    }

    expect(runner.getSession().entries).toHaveLength(1)
  })

  it('rejects a second decode arriving in the same tick, before any await', async () => {
    // The guarantee that matters. Two decodes a frame apart both see a session
    // React has not re-rendered yet; admission has to be synchronous.
    const { runner, performed, qr } = harness({
      units: { u1: unit({ status: 'available' }) },
    })
    runner.setMode('check_out')

    expect(runner.handleDecoded(qr('u1'))).toBeNull()
    expect(runner.handleDecoded(qr('u1'))?.kind).toBe('duplicate')
    expect(runner.handleDecoded(qr('u1'))?.kind).toBe('duplicate')

    await settle()

    expect(performed).toHaveLength(1)
    expect(runner.getSession().entries).toHaveLength(1)
  })

  it('starts exactly one write even when the write is slow', async () => {
    // Assigned synchronously by the Promise constructor; TypeScript cannot see
    // that, hence the definite-assignment assertion.
    let release!: () => void
    const slow = new Promise<void>((resolve) => { release = resolve })

    const { runner, performed, qr } = harness({
      units: { u1: unit() },
      perform: () => slow,
    })
    runner.setMode('check_out')

    runner.handleDecoded(qr('u1'))
    await settle()

    // Mid-write: no result yet, and the code is still in frame.
    expect(runner.getSession().entries[0]?.outcome).toBe('processing')
    for (let i = 0; i < 5; i += 1) {
      expect(runner.handleDecoded(qr('u1'))?.kind).toBe('duplicate')
    }

    release()
    await settle()

    expect(performed).toHaveLength(1)
    expect(runner.getSession().entries[0]?.outcome).toBe('success')
  })
})

describe('sweeping a shelf', () => {
  it('handles three different units independently', async () => {
    const { runner, performed, qr } = harness({
      units: {
        u1: unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
        u2: unit({ unit_id: 'u2', asset_code: 'MIC-002' }),
        u3: unit({ unit_id: 'u3', asset_code: 'MIC-003' }),
      },
    })
    runner.setMode('check_out')

    runner.handleDecoded(qr('u1'))
    runner.handleDecoded(qr('u2'))
    runner.handleDecoded(qr('u3'))
    await settle()

    expect(performed).toHaveLength(3)
    expect(runner.getSession().entries.map((e) => e.assetCode))
      .toEqual(['MIC-003', 'MIC-002', 'MIC-001'])
    expect(runner.getSession().entries.every((e) => e.outcome === 'success')).toBe(true)
    expect(runner.getSession().inFlight).toEqual([])
  })

  it('keeps a failure beside the successes rather than hiding it', async () => {
    // Partial results are the honest outcome of scanning a shelf. One unit the
    // person may not edit must not discard the two that worked.
    const { runner, qr } = harness({
      units: {
        u1: unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
        u2: unit({ unit_id: 'u2', asset_code: 'MIC-002' }),
        u3: unit({ unit_id: 'u3', asset_code: 'MIC-003' }),
      },
      perform: async (action) => {
        if (action.unit.unit_id === 'u2') {
          throw new FirebaseError('permission-denied', 'Missing or insufficient permissions.')
        }
      },
    })
    runner.setMode('check_out')

    for (const id of ['u1', 'u2', 'u3']) runner.handleDecoded(qr(id))
    await settle()

    const byCode = Object.fromEntries(
      runner.getSession().entries.map((e) => [e.assetCode, e]),
    )
    expect(byCode['MIC-001']?.outcome).toBe('success')
    expect(byCode['MIC-003']?.outcome).toBe('success')
    expect(byCode['MIC-002']?.outcome).toBe('failed')
    expect(byCode['MIC-002']?.message).toBe('You don’t have permission to update this equipment.')
  })
})

describe('what each mode does to the equipment', () => {
  it('inspecting writes nothing', async () => {
    const { runner, performed, qr } = harness({ units: { u1: unit({ status: 'in_use' }) } })

    runner.handleDecoded(qr('u1'))
    await settle()

    expect(performed).toHaveLength(0)
    const entry = runner.getSession().entries[0]
    expect(entry?.outcome).toBe('success')
    expect(entry?.message).toContain('In use')
    expect(entry?.itemName).toBe('Wireless Handheld')
  })

  it('checking out sends the using team and member through the lifecycle service', async () => {
    const { runner, performed, qr } = harness({
      units: { u1: unit({ status: 'available' }) },
      context: { usingTeamId: 'team-lighting', usingMemberUid: 'uid-9' },
    })
    runner.setMode('check_out')

    runner.handleDecoded(qr('u1'))
    await settle()

    expect(performed[0]).toMatchObject({
      to: 'in_use', usingTeamId: 'team-lighting', usingMemberUid: 'uid-9',
    })
    // The whole unit is handed over, so the service re-reads it in its own
    // transaction rather than trusting anything assembled here.
    expect(performed[0]?.unit.unit_id).toBe('u1')
  })

  it('checking in clears the usage fields rather than carrying them over', async () => {
    const { runner, performed, qr } = harness({
      units: { u1: unit({ status: 'in_use', using_team_id: 'team-lighting' }) },
      context: { usingTeamId: 'team-lighting', usingMemberUid: 'uid-9' },
    })
    runner.setMode('check_in')

    runner.handleDecoded(qr('u1'))
    await settle()

    expect(performed[0]).toMatchObject({
      to: 'available', usingTeamId: null, usingMemberUid: null,
    })
  })

  it('warns instead of writing when the state is wrong for the mode', async () => {
    const { runner, performed, qr } = harness({
      units: { u1: unit({ status: 'in_maintenance' }) },
    })
    runner.setMode('check_out')

    runner.handleDecoded(qr('u1'))
    await settle()

    expect(performed).toHaveLength(0)
    expect(runner.getSession().entries[0]).toMatchObject({
      outcome: 'warning', assetCode: 'MIC-001',
    })
    expect(runner.getSession().entries[0]?.message).toContain('currently in maintenance')
  })
})

describe('equipment the scanner cannot open', () => {
  it('says one thing whether it is denied or absent', async () => {
    const denied = harness({
      readUnit: async () => {
        throw new FirebaseError('permission-denied', 'Missing or insufficient permissions.')
      },
    })
    denied.runner.handleDecoded(denied.qr('u1'))

    const absent = harness({ readUnit: async () => null })
    absent.runner.handleDecoded(absent.qr('u9'))

    await settle()

    const a = denied.runner.getSession().entries[0]
    const b = absent.runner.getSession().entries[0]
    expect(a?.outcome).toBe('failed')
    expect(b?.outcome).toBe('failed')
    expect(a?.message).toBe(b?.message)
    expect(a?.message).toContain('couldn’t open')
  })

  it('never shows a raw Firebase error', async () => {
    const { runner, qr } = harness({
      units: { u1: unit() },
      perform: async () => {
        throw new FirebaseError('resource-exhausted', 'Quota exceeded for project demo-x.')
      },
    })
    runner.setMode('check_out')

    runner.handleDecoded(qr('u1'))
    await settle()

    const message = runner.getSession().entries[0]?.message ?? ''
    expect(message).not.toContain('demo-x')
    expect(message).not.toContain('Quota')
    expect(message).not.toContain('resource-exhausted')
  })
})

describe('going back to a unit deliberately', () => {
  it('may be scanned again after being forgotten', async () => {
    const { runner, performed, qr } = harness({ units: { u1: unit() } })
    runner.setMode('check_out')

    runner.handleDecoded(qr('u1'))
    await settle()
    expect(runner.handleDecoded(qr('u1'))?.kind).toBe('duplicate')

    runner.forget('u1')
    expect(runner.handleDecoded(qr('u1'))).toBeNull()
    await settle()

    expect(performed).toHaveLength(2)
  })

  it('starts over when the session is cleared', async () => {
    const { runner, qr } = harness()

    runner.handleDecoded(qr('u1'))
    await settle()
    runner.clear()

    expect(runner.getSession().entries).toHaveLength(0)
    expect(runner.handleDecoded(qr('u1'))).toBeNull()
  })

  it('starts over when the mode changes', async () => {
    const { runner, qr } = harness()

    runner.handleDecoded(qr('u1'))
    await settle()
    runner.setMode('check_in')

    expect(runner.getSession().entries).toHaveLength(0)
    expect(runner.getSession().mode).toBe('check_in')
  })
})

describe('telling the interface what changed', () => {
  it('notifies subscribers on every step', async () => {
    const { runner, qr } = harness()
    const seen = vi.fn()
    runner.subscribe(seen)

    runner.handleDecoded(qr('u1'))
    await settle()

    // At least the placeholder row and the finished one.
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(seen.mock.calls.at(-1)?.[0].entries[0].outcome).toBe('success')
  })

  it('stops notifying once unsubscribed', async () => {
    const { runner, qr } = harness()
    const seen = vi.fn()
    runner.subscribe(seen)()

    runner.handleDecoded(qr('u1'))
    await settle()

    expect(seen).not.toHaveBeenCalled()
  })
})

/**
 * An item label is a real label the scanner has no action for.
 *
 * The scanner's three modes are unit lifecycle writes. A bulk item has no unit
 * to write to — its quantity is a number, not a set of identities — so the only
 * honest response is to say what was scanned and offer to open it. What must not
 * happen is a Check Out that appears to work and changes nothing, or an item id
 * quietly entering the session as though it were a unit.
 */
describe('scanning an inventory item label', () => {
  it('recognises it rather than rejecting it as an unknown code', () => {
    const { runner } = harness()

    const outcome = runner.handleDecoded(inventoryItemQrUrl('item-1'))

    expect(outcome?.kind).toBe('item')
    expect(outcome && 'itemId' in outcome ? outcome.itemId : null).toBe('item-1')
  })

  it('performs no lifecycle write, in any mode', async () => {
    for (const mode of ['inspect', 'check_out', 'check_in'] as const) {
      const { runner, performed } = harness()
      runner.setMode(mode)

      runner.handleDecoded(inventoryItemQrUrl('item-1'))
      await settle()

      expect(performed).toEqual([])
    }
  })

  it('adds nothing to the scan session', async () => {
    const { runner } = harness()

    runner.handleDecoded(inventoryItemQrUrl('item-1'))
    await settle()

    expect(runner.getSession().entries).toEqual([])
  })

  it('does not read the item id as a unit id', async () => {
    const readUnit = vi.fn(async () => null)
    const { runner } = harness({ readUnit })

    runner.handleDecoded(inventoryItemQrUrl('item-1'))
    await settle()

    expect(readUnit).not.toHaveBeenCalled()
  })

  it('still runs the ordinary unit flow for a unit label', async () => {
    const { runner, performed } = harness()
    runner.setMode('check_out')

    runner.handleDecoded(equipmentQrUrl('u1'))
    await settle()

    expect(performed).toHaveLength(1)
    expect(runner.getSession().entries).toHaveLength(1)
  })

  it('still refuses a code that is neither', () => {
    const { runner } = harness()

    expect(runner.handleDecoded('https://example.com/inventory/item-1')?.kind).toBe('invalid_qr')
    expect(runner.handleDecoded('not a url')?.kind).toBe('invalid_qr')
  })
})
