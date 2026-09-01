import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
import { routes } from '@/routes/routes'
import { paths } from '@/routes/paths'
import {
  AdminGuard, AuthGuard, GuestGuard, MembershipGuard, OrganizationGuard, PermissionGuard,
} from '@/routes/guards'

/**
 * The guard chain, asserted as data.
 *
 * Phase 11E moved one route — the equipment deep link — out from under the
 * active organization's guards, because a scanned QR carries a document id and
 * nothing else: which organization owns it is stored in the record, so a guard
 * bound to whichever organization the browser happens to have open would refuse
 * legitimate scans before the page could find out.
 *
 * Phase 11I moved the item detail page to join it, when bulk items got labels of
 * their own. Leaving it inside the guards meant they were evaluated against the
 * wrong organization — a person with inventory access in A, browsing B, was
 * refused for a record A had already authorized — and two label types with
 * different cross-organization behavior is worse than one shared resolver.
 *
 * So the exception is now exactly two routes, both of which reconstruct the
 * render boundary in the page via `resolveDeepLink`. Exceptions spread, and
 * these tests walk the real route tree so that the day somebody adds a third, or
 * re-nests one "for consistency", the suite says so.
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
const ITEM_DETAIL = '/inventory/:itemId'

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
      // The item deep link, for the same reason and with the same resolver.
      ITEM_DETAIL,
      // The directory asks only for an active membership, so somebody waiting
      // for an assignment can still see who is here. It grants nothing else.
      paths.contacts,
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

  it('lets an unassigned member reach the directory, and nothing else', () => {
    // Being a member is the whole qualification for a directory. Every module
    // still asks for a permission an unassigned member does not have.
    expect(isUnder(paths.contacts, AuthGuard)).toBe(true)
    expect(isUnder(paths.contacts, MembershipGuard)).toBe(true)
    expect(isUnder(paths.contacts, OrganizationGuard)).toBe(false)
    expect(isUnder(paths.contacts, PermissionGuard)).toBe(false)
    expect(isUnder(paths.contacts, AdminGuard)).toBe(false)
  })

  it('gives the directory the shell, so its header controls come with it', () => {
    expect(guardsFor(paths.contacts).length).toBeGreaterThan(2)
  })

  it('puts nothing else behind the membership guard', () => {
    // The exception is one route. Anything else appearing here would be a
    // module reachable without the permission it is supposed to require.
    const behind = all
      .filter((entry) => entry.guards.includes(MembershipGuard))
      .map((entry) => entry.path)

    expect(behind).toEqual([paths.contacts])
  })

  it('keeps the scanner inside the active organization, unlike the deep link', () => {
    // The scanner is the opposite case to /equipment/:unitId. A session is
    // opened in one organization on purpose, so it stays behind both guards.
    expect(isUnder(paths.scanner, OrganizationGuard)).toBe(true)
    expect(isUnder(paths.scanner, PermissionGuard)).toBe(true)
    expect(isUnder(paths.scanner, AuthGuard)).toBe(true)
  })

  it('keeps every other inventory page behind the inventory permission', () => {
    // The two deep links are absent on purpose; everything else that touches
    // inventory — including editing an item — still asks the active
    // organization's guards.
    for (const path of [paths.inventory, paths.inventoryNew, paths.scanner, '/inventory/:itemId/edit']) {
      expect(isUnder(path, PermissionGuard), path).toBe(true)
      expect(isUnder(path, OrganizationGuard), path).toBe(true)
    }
  })

  it('places the item deep link exactly where the equipment one is', () => {
    // Same guards, so the two labels cannot drift into different behavior.
    for (const path of [EQUIPMENT, ITEM_DETAIL]) {
      expect(isUnder(path, AuthGuard), path).toBe(true)
      expect(isUnder(path, OrganizationGuard), path).toBe(false)
      expect(isUnder(path, PermissionGuard), path).toBe(false)
      expect(isUnder(path, MembershipGuard), path).toBe(false)
      expect(isUnder(path, AdminGuard), path).toBe(false)
    }

    const names = (path: string) => guardsFor(path).map((g) => (g as GuardComponent).name)
    expect(names(ITEM_DETAIL)).toEqual(names(EQUIPMENT))
  })

  it('still requires editing an item to pass the guards the deep link skips', () => {
    // Reading a scanned label is the exception. Changing what it points at is
    // not, and the edit route is the one that would quietly inherit it.
    expect(isUnder('/inventory/:itemId/edit', OrganizationGuard)).toBe(true)
    expect(isUnder('/inventory/:itemId/edit', PermissionGuard)).toBe(true)
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
