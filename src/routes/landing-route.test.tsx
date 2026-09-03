import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { routes } from '@/routes/routes'
import { paths } from '@/routes/paths'
import { AuthGuard, GuestGuard, LandingGate, OrganizationGuard } from '@/routes/guards'

/**
 * The landing page is the first thing in this application that a signed-out
 * visitor is allowed to see, which makes it the first thing that could
 * accidentally show them something else.
 *
 * Two properties matter and neither is visible by reading one file:
 *
 * 1. `LandingGate` must sit *above* `AuthGuard`, or the guard redirects every
 *    signed-out visitor to the log-in form before the landing page renders.
 * 2. Sitting above `AuthGuard` means every module path passes through the gate
 *    too. Those are not public, and the day the root-path check is loosened,
 *    the whole application becomes reachable without signing in.
 *
 * So this walks the real route tree rather than trusting the arrangement to
 * stay as written.
 */

function collectPaths(
  nodes: readonly RouteObject[],
  enclosing: readonly unknown[] = [],
): { path: string; guards: readonly unknown[] }[] {
  const found: { path: string; guards: readonly unknown[] }[] = []

  for (const node of nodes) {
    const element: unknown = node.element
    const guards = isValidElement(element)
      ? [...enclosing, (element as ReactElement).type]
      : enclosing

    if (typeof node.path === 'string') {
      found.push({ path: node.path, guards })
    }
    if (node.children) {
      found.push(...collectPaths(node.children, guards))
    }
  }

  return found
}

const all = collectPaths(routes)

function guardsFor(path: string): readonly unknown[] {
  const match = all.find((entry) => entry.path === path)
  expect(match, `no route configured for ${path}`).toBeDefined()
  return match?.guards ?? []
}

describe('the root path serves two pages', () => {
  it('keeps the dashboard at /, where organization selection sends people', () => {
    // Redirecting a signed-in visitor away from `/` would send them to
    // selection, which sends them back to `/`. The dashboard stays put.
    expect(paths.dashboard).toBe('/')
    expect(paths.landing).toBe('/')
  })

  it('configures the root exactly once, so nothing competes to render there', () => {
    // Two routes claiming `/` would be decided by declaration order rather than
    // by authentication, which is the one thing that is supposed to decide it.
    expect(all.filter((entry) => entry.path === '/')).toHaveLength(1)
  })

  it('still puts the signed-in half behind the gate, the guard, and the shell', () => {
    // The landing page is an addition to the root, not a replacement for what
    // was there: a signed-in visitor must still clear authentication and
    // organization selection before the dashboard renders.
    const chain = guardsFor(paths.dashboard)

    expect(chain).toContain(LandingGate)
    expect(chain).toContain(AuthGuard)
    expect(chain).toContain(OrganizationGuard)
  })
})

describe('the gate is above the guard, and only there', () => {
  it('sits outside AuthGuard on the root branch', () => {
    const chain = guardsFor(paths.inventory)
    const gate = chain.indexOf(LandingGate)
    const auth = chain.indexOf(AuthGuard)

    expect(gate).toBeGreaterThanOrEqual(0)
    expect(auth).toBeGreaterThanOrEqual(0)
    expect(gate).toBeLessThan(auth)
  })

  it('still requires signing in for everything underneath it', () => {
    // The gate opens one path. Anything it encloses is still behind AuthGuard,
    // and this is the assertion that fails if the root check ever widens.
    const enclosed = all.filter((entry) => entry.guards.includes(LandingGate))

    expect(enclosed.length).toBeGreaterThan(0)
    for (const entry of enclosed) {
      expect(entry.guards, entry.path).toContain(AuthGuard)
    }
  })

  it('leaves the authentication screens alone', () => {
    for (const path of [paths.logIn, paths.signUp]) {
      expect(guardsFor(path)).toContain(GuestGuard)
      expect(guardsFor(path)).not.toContain(LandingGate)
    }
  })

  it('leaves organization selection and the scanned labels alone', () => {
    for (const path of [paths.organizations, '/equipment/:unitId', '/inventory/:itemId']) {
      expect(guardsFor(path), path).not.toContain(LandingGate)
      expect(guardsFor(path), path).toContain(AuthGuard)
    }
  })

  it('did not disturb the organization guards it now encloses', () => {
    for (const path of [paths.inventory, paths.maintenance, paths.productions, paths.calendar]) {
      expect(guardsFor(path), path).toContain(OrganizationGuard)
    }
  })
})
