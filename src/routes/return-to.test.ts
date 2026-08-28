import { describe, expect, it } from 'vitest'
import {
  afterAuthDestination, locationToReturnPath, returnToFromState, safeReturnPath,
} from '@/routes/return-to'
import { paths } from '@/routes/paths'

/**
 * The deep-link contract, end to end at the value level.
 *
 * A scanned label survives sign-in only if the guard that intercepts it, the
 * sign-in screen, and organization selection all agree on what a stored
 * destination looks like. These tests compose those steps in the same order the
 * application does, rather than checking each in isolation with an
 * already-convenient value — the bug this suite exists for was a disagreement
 * between two components that were each correct on their own.
 */

/** What React Router hands a guard. */
function routerLocation(pathname: string, search = '', hash = '') {
  return { pathname, search, hash, state: null, key: 'test' }
}

describe('a deep link that goes through sign-in', () => {
  it('comes back to the equipment it started at', () => {
    // The whole flow: AuthGuard stores where the person was going, sign-in
    // reads it back, and the destination is the same equipment.
    const requested = routerLocation('/equipment/unit-123')

    const stored = { from: locationToReturnPath(requested) }

    expect(afterAuthDestination(stored)).toBe('/equipment/unit-123')
    expect(afterAuthDestination(stored)).not.toBe(paths.organizations)
  })

  it('keeps a query string and a fragment', () => {
    const requested = routerLocation('/equipment/unit-123', '?tab=history', '#events')
    const stored = { from: locationToReturnPath(requested) }

    expect(afterAuthDestination(stored)).toBe('/equipment/unit-123?tab=history#events')
  })

  it('survives being stored by one component and read by another', () => {
    // Both the sign-in screen and the guard that keeps signed-in people away
    // from it answer this question, within a frame of each other. If they
    // disagreed, whichever landed last would decide — and the deep link would
    // be lost about half the time.
    const stored = { from: locationToReturnPath(routerLocation('/equipment/unit-123')) }

    expect(returnToFromState(stored)).toBe('/equipment/unit-123')
    expect(afterAuthDestination(stored)).toBe(returnToFromState(stored))
  })
})

describe('a location reduced to a return path', () => {
  it('is a string, never the location object it came from', () => {
    // The object shape reads perfectly well at the storing end and is silently
    // discarded by the validator at the far end.
    const path = locationToReturnPath(routerLocation('/equipment/unit-123'))

    expect(typeof path).toBe('string')
    expect(safeReturnPath(path)).toBe('/equipment/unit-123')
    expect(safeReturnPath(routerLocation('/equipment/unit-123'))).toBeNull()
  })

  it('handles a location with no query or fragment', () => {
    expect(locationToReturnPath({ pathname: '/inventory' })).toBe('/inventory')
  })
})

describe('ordinary sign-in, with nowhere in particular to go', () => {
  it('goes to organization selection as it always did', () => {
    expect(afterAuthDestination(null)).toBe(paths.organizations)
    expect(afterAuthDestination(undefined)).toBe(paths.organizations)
    expect(afterAuthDestination({})).toBe(paths.organizations)
  })

  it('goes to organization selection rather than crashing on a malformed state', () => {
    for (const state of ['a string', 42, [], { from: 42 }, { from: null }, { notFrom: '/x' }]) {
      expect(afterAuthDestination(state)).toBe(paths.organizations)
    }
  })

  it('refuses to be sent somewhere else entirely, and falls back safely', () => {
    for (const hostile of [
      'https://evil.example.com',
      '//evil.example.com',
      '/javascript:alert(1)',
      '/\\evil.example.com',
      'equipment/unit-123',
    ]) {
      expect(afterAuthDestination({ from: hostile })).toBe(paths.organizations)
    }
  })
})

describe('where a sign-in may return to', () => {
  it('keeps an internal equipment path', () => {
    expect(safeReturnPath('/equipment/unit-abc')).toBe('/equipment/unit-abc')
  })

  it('keeps other internal paths', () => {
    expect(safeReturnPath('/inventory')).toBe('/inventory')
    expect(safeReturnPath('/maintenance/rec-1')).toBe('/maintenance/rec-1')
  })

  it('refuses somewhere else entirely', () => {
    // Sending people to an arbitrary URL right after they type a password is
    // how phishing works.
    expect(safeReturnPath('https://evil.example.com')).toBeNull()
    expect(safeReturnPath('http://evil.example.com/equipment/x')).toBeNull()
  })

  it('refuses a protocol-relative URL, which is somewhere else in disguise', () => {
    expect(safeReturnPath('//evil.example.com')).toBeNull()
    expect(safeReturnPath('//evil.example.com/equipment/x')).toBeNull()
  })

  it('refuses a scheme smuggled after the slash', () => {
    expect(safeReturnPath('/javascript:alert(1)')).toBeNull()
    expect(safeReturnPath('/data:text/html,x')).toBeNull()
  })

  it('refuses a backslash, which some browsers read as a slash', () => {
    expect(safeReturnPath('/\\evil.example.com')).toBeNull()
    expect(safeReturnPath('\\\\evil.example.com')).toBeNull()
  })

  it('refuses a bare path with no root', () => {
    expect(safeReturnPath('equipment/unit-abc')).toBeNull()
  })

  it('refuses anything that is not a string, or is empty', () => {
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath(null)).toBeNull()
    expect(safeReturnPath(42)).toBeNull()
    expect(safeReturnPath({ from: '/equipment/x' })).toBeNull()
    expect(safeReturnPath('')).toBeNull()
    expect(safeReturnPath('   ')).toBeNull()
  })
})