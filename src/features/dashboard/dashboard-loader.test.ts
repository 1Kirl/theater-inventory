import { describe, expect, it, vi } from 'vitest'
import {
  fetchPlan, loadDashboard, type DashboardLoaders, type DashboardModule, type ModuleOutcome,
} from '@/features/dashboard/dashboard-loader'
import type { DashboardAccess } from '@/features/dashboard/dashboard-summary'

/**
 * The property the dashboard's permission model rests on: a module the user
 * cannot view is never asked for.
 *
 * The loaders are injected, so this checks what was called rather than what was
 * rendered.
 */

function access(overrides: Partial<DashboardAccess> = {}): DashboardAccess {
  return { inventory: false, maintenance: false, productions: false, calendar: false, ...overrides }
}

type CallCounts = Record<DashboardModule, number>

function spyLoaders(): { loaders: DashboardLoaders; calls: CallCounts } {
  const calls: CallCounts = { inventory: 0, maintenance: 0, productions: 0, calendar: 0 }

  return {
    calls,
    loaders: {
      inventory: vi.fn(() => { calls.inventory += 1; return Promise.resolve([]) }),
      maintenance: vi.fn(() => { calls.maintenance += 1; return Promise.resolve([]) }),
      productions: vi.fn(() => {
        calls.productions += 1
        return Promise.resolve({ productions: [], requirements: [], actions: [] })
      }),
      calendar: vi.fn(() => { calls.calendar += 1; return Promise.resolve([]) }),
    },
  }
}

async function run(given: DashboardAccess, loaders: DashboardLoaders) {
  const settled: ModuleOutcome[] = []
  await loadDashboard({
    organizationId: 'org-1',
    access: given,
    loaders,
    onSettled: (outcome) => settled.push(outcome),
  })
  return settled
}

describe('fetchPlan', () => {
  it('plans nothing for a user with no module access', () => {
    expect(fetchPlan(access())).toEqual([])
  })

  it('plans only the modules the user may view', () => {
    expect(fetchPlan(access({ inventory: true, calendar: true })))
      .toEqual(['inventory', 'calendar'])
  })

  it('plans everything for a user who may view everything', () => {
    expect(fetchPlan(access({
      inventory: true, maintenance: true, productions: true, calendar: true,
    }))).toEqual(['inventory', 'maintenance', 'productions', 'calendar'])
  })
})

describe('loadDashboard', () => {
  it('never calls a loader for a module the user cannot view', async () => {
    const { loaders, calls } = spyLoaders()
    await run(access({ inventory: true }), loaders)

    expect(calls).toEqual({ inventory: 1, maintenance: 0, productions: 0, calendar: 0 })
  })

  it('calls nothing at all when no module is viewable', async () => {
    const { loaders, calls } = spyLoaders()
    const settled = await run(access(), loaders)

    expect(calls).toEqual({ inventory: 0, maintenance: 0, productions: 0, calendar: 0 })
    expect(settled).toEqual([])
  })

  it('passes the active organization to every loader it does call', async () => {
    // Nothing is read without an organization ID, so no other organization's
    // records can be reached.
    const { loaders } = spyLoaders()
    await run(access({ inventory: true, calendar: true }), loaders)

    expect(loaders.inventory).toHaveBeenCalledWith('org-1')
    expect(loaders.calendar).toHaveBeenCalledWith('org-1')
  })

  it('reports each module as it settles', async () => {
    const { loaders } = spyLoaders()
    const settled = await run(access({ inventory: true, maintenance: true }), loaders)

    expect(settled.map((outcome) => outcome.module).sort())
      .toEqual(['inventory', 'maintenance'])
    expect(settled.every((outcome) => outcome.result.ok)).toBe(true)
  })

  it('lets one module fail without taking the others down', async () => {
    const { loaders } = spyLoaders()
    const failing: DashboardLoaders = {
      ...loaders,
      maintenance: () => Promise.reject(new Error('permission-denied')),
    }

    const settled = await run(access({ inventory: true, maintenance: true }), failing)
    const byModule = new Map(settled.map((outcome) => [outcome.module, outcome.result]))

    expect(byModule.get('inventory')?.ok).toBe(true)
    expect(byModule.get('maintenance')?.ok).toBe(false)
  })

  it('does not reject when a module fails', async () => {
    const failing: DashboardLoaders = {
      ...spyLoaders().loaders,
      calendar: () => Promise.reject(new Error('boom')),
    }

    await expect(run(access({ calendar: true }), failing)).resolves.toBeDefined()
  })
})
