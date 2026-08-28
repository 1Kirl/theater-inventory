import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { routes } from '@/routes/routes'
import { paths } from '@/routes/paths'
import {
  AdminGuard, AuthGuard, GuestGuard, OrganizationGuard, PermissionGuard,
} from '@/routes/guards'

/**
 * The guard chain, asserted as data.
 *
 * Phase 11E moved exactly one route — the equipment deep link — out from under
 * the active organization's guards, because a scanned QR carries a unit id and
 * nothing else: which organization owns that unit is stored in the unit, so a
 * guard bound to whichever organization the browser happens to have open would
 * refuse legitimate scans before the page could find out.
 *
 * That is a deliberate exception, and exceptions spread. These tests walk the
 * real route tree so that the day somebody adds a page next to it, or re-nests
 * it "for consistency", the suite says so.
 *
 * No DOM and no router are involved. This inspects configuration, which is
 * exactly the thing at risk.
 */

type GuardComponent = (props: never) => unknown

/** Every path in the tree, each with the guards it is nested inside. */
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

function isUnder(path: string, guard: GuardComponent): boolean {
  return guardsFor(path).includes(guard)
}

const EQUIPMENT = '/equipment/:unitId'

describe('the equipment deep link', () => {
  it('is still configured, at the path the QR encodes', () => {
    // If these ever drift apart, every label already printed stops resolving.
    expect(all.map((entry) => entry.path)).toContain(EQUIPMENT)
    expect(paths.inventoryUnit('unit-1')).toBe('/equipment/unit-1')
  })

  it('still requires signing in', () => {
    // The routing exception is about which organization, never about whether
    // somebody is signed in. A label is a shortcut for people who have access,
    // not a way to obtain it.
    expect(isUnder(EQUIPMENT, AuthGuard)).toBe(true)
  })

  it('is not gated on whichever organization the browser has open', () => {
    // Both of these would refuse a legitimate scan of equipment belonging to
    // another of the person's own organizations, before the page could read the
    // unit and discover which organization that is.
    expect(isUnder(EQUIPMENT, OrganizationGuard)).toBe(false)
    expect(isUnder(EQUIPMENT, PermissionGuard)).toBe(false)
  })

  it('is not exposed to signed-out visitors through the guest routes', () => {
    expect(isUnder(EQUIPMENT, GuestGuard)).toBe(false)
  })

  it('still renders inside the application shell', () => {
    // Reached from the inventory page far more often than from a camera, so it
    // must not lose its navigation to gain the deep link.
    expect(guardsFor(EQUIPMENT).length).toBeGreaterThan(1)
  })
})

describe('the exception did not spread', () => {
  it('is the only route outside the organization guards, apart from the entry pages', () => {
    // Anything else that leaves OrganizationGuard is a mistake until somebody
    // argues otherwise in a decision record.
    const allowedOutside = new Set<string>([
      EQUIPMENT,
      // Signing in and choosing an organization necessarily precede having one.
      paths.logIn,
      paths.signUp,
      paths.organizations,
      paths.createOrganization,
      paths.joinOrganization,
      '*',
    ])

    const outside = all
      .filter((entry) => !entry.guards.includes(OrganizationGuard))
      .map((entry) => entry.path)
      .filter((path) => !allowedOutside.has(path))

    expect(outside).toEqual([])
  })

  it('keeps every other inventory page behind the inventory permission', () => {
    for (const path of [paths.inventory, paths.inventoryNew, '/inventory/:itemId']) {
      expect(isUnder(path, PermissionGuard), path).toBe(true)
      expect(isUnder(path, OrganizationGuard), path).toBe(true)
    }
  })

  it('keeps administration behind the admin guard', () => {
    const admin = all.filter((entry) => entry.guards.includes(AdminGuard))
    expect(admin.length).toBeGreaterThan(0)
    for (const entry of admin) {
      expect(entry.guards).toContain(OrganizationGuard)
    }
  })

  it('leaves no other module unguarded', () => {
    for (const path of [paths.maintenance, paths.productions, paths.calendar]) {
      expect(isUnder(path, PermissionGuard), path).toBe(true)
    }
  })
})
