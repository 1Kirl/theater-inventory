import { describe, expect, it } from 'vitest'
import {
  SCAN_MODES, admitScan, beginScan, clearSession, completeScan, emptySession, forgetScan,
  modeMutates, sessionCounts, switchMode, type ScanSession,
} from '@/features/scanner/scan-session'

/** One decode, all the way through, as the scanner does it. */
function scan(session: ScanSession, unitId: string, outcome: 'success' | 'warning' | 'failed' = 'success'): ScanSession {
  const admission = admitScan(session, unitId)
  if (!admission.admit) return session

  const started = beginScan(session, { unitId, at: 1 })
  return completeScan(started, { unitId, outcome, message: 'done', assetCode: unitId.toUpperCase() })
}

describe('scanning one unit', () => {
  it('accepts it the first time', () => {
    expect(admitScan(emptySession('inspect'), 'u1')).toEqual({ admit: true })
  })

  it('shows a row immediately, before the answer is known', () => {
    // Somebody sweeping a shelf needs to see the scan registered now, not when
    // the write comes back.
    const session = beginScan(emptySession('check_out'), { unitId: 'u1', at: 5 })

    expect(session.entries).toHaveLength(1)
    expect(session.entries[0]?.outcome).toBe('processing')
    expect(session.entries[0]?.unitId).toBe('u1')
    expect(session.inFlight).toEqual(['u1'])
  })

  it('replaces that row with what happened', () => {
    const started = beginScan(emptySession('check_out'), { unitId: 'u1', at: 5 })
    const done = completeScan(started, {
      unitId: 'u1', outcome: 'success', message: 'Checked out', assetCode: 'MIC-001',
      itemName: 'Wireless Handheld',
    })

    expect(done.entries).toHaveLength(1)
    expect(done.entries[0]).toMatchObject({
      unitId: 'u1', outcome: 'success', message: 'Checked out', assetCode: 'MIC-001',
      itemName: 'Wireless Handheld',
    })
    expect(done.inFlight).toEqual([])
  })
})

describe('the same sticker staying in front of the camera', () => {
  it('is refused once it has been handled', () => {
    // A decoder reading ten frames a second would otherwise check the same
    // microphone out ten times.
    const session = scan(emptySession('check_out'), 'u1')
    const again = admitScan(session, 'u1')

    expect(again.admit).toBe(false)
    if (!again.admit) {
      expect(again.reason).toBe('already_scanned')
      expect(again.entry?.assetCode).toBe('U1')
    }
  })

  it('is refused while its write is still running', () => {
    // The guard that actually matters. Between starting a transaction and it
    // returning there is no result to recognise, and two decodes a few hundred
    // milliseconds apart would both look new.
    const started = beginScan(emptySession('check_out'), { unitId: 'u1', at: 1 })
    const again = admitScan(started, 'u1')

    expect(again.admit).toBe(false)
    if (!again.admit) expect(again.reason).toBe('in_flight')
  })

  it('never produces a second row for the same unit', () => {
    let session = emptySession('check_out')
    for (let i = 0; i < 20; i += 1) session = scan(session, 'u1')

    expect(session.entries).toHaveLength(1)
    expect(session.inFlight).toEqual([])
  })

  it('is still refused after a failure, so a bad scan cannot loop', () => {
    // A unit sitting in frame with a permission error must not retry forever.
    const session = scan(emptySession('check_out'), 'u1', 'failed')
    expect(admitScan(session, 'u1').admit).toBe(false)
  })
})

describe('scanning several different units', () => {
  it('keeps one row each, newest first', () => {
    let session = emptySession('check_out')
    for (const id of ['u1', 'u2', 'u3']) session = scan(session, id)

    expect(session.entries.map((entry) => entry.unitId)).toEqual(['u3', 'u2', 'u1'])
    expect(session.inFlight).toEqual([])
  })

  it('lets a second unit through while the first is still writing', () => {
    // Independent equipment, independent transactions. Somebody scanning a shelf
    // should not wait for each write before the next sticker registers.
    const first = beginScan(emptySession('check_out'), { unitId: 'u1', at: 1 })

    expect(admitScan(first, 'u2')).toEqual({ admit: true })

    const both = beginScan(first, { unitId: 'u2', at: 2 })
    expect(both.inFlight).toEqual(['u1', 'u2'])

    // And each removes only itself when it finishes.
    const firstDone = completeScan(both, { unitId: 'u1', outcome: 'success', message: 'ok' })
    expect(firstDone.inFlight).toEqual(['u2'])
    expect(firstDone.entries.find((e) => e.unitId === 'u2')?.outcome).toBe('processing')
  })

  it('completes out of order without dropping anything', () => {
    let session = beginScan(emptySession('check_out'), { unitId: 'u1', at: 1 })
    session = beginScan(session, { unitId: 'u2', at: 2 })
    session = beginScan(session, { unitId: 'u3', at: 3 })

    session = completeScan(session, { unitId: 'u2', outcome: 'success', message: 'b' })
    session = completeScan(session, { unitId: 'u3', outcome: 'failed', message: 'c' })
    session = completeScan(session, { unitId: 'u1', outcome: 'warning', message: 'a' })

    expect(session.inFlight).toEqual([])
    expect(session.entries.map((e) => `${e.unitId}:${e.outcome}`))
      .toEqual(['u3:failed', 'u2:success', 'u1:warning'])
  })
})

describe('deliberately going back to a unit', () => {
  it('can be forgotten so the camera may act on it again', () => {
    const session = scan(emptySession('check_out'), 'u1', 'failed')
    const forgotten = forgetScan(session, 'u1')

    expect(forgotten.entries).toHaveLength(0)
    expect(admitScan(forgotten, 'u1')).toEqual({ admit: true })
  })

  it('does not release a write that is still running', () => {
    // Otherwise "scan again" during a slow write would start a second one.
    const started = beginScan(emptySession('check_out'), { unitId: 'u1', at: 1 })
    const forgotten = forgetScan(started, 'u1')

    expect(forgotten.inFlight).toEqual(['u1'])
    expect(admitScan(forgotten, 'u1').admit).toBe(false)
  })

  it('leaves the other rows alone', () => {
    let session = emptySession('inspect')
    for (const id of ['u1', 'u2', 'u3']) session = scan(session, id)

    expect(forgetScan(session, 'u2').entries.map((e) => e.unitId)).toEqual(['u3', 'u1'])
  })

  it('clears the whole session but keeps the intent', () => {
    let session = emptySession('check_out')
    for (const id of ['u1', 'u2']) session = scan(session, id)

    const cleared = clearSession(session)
    expect(cleared.entries).toHaveLength(0)
    expect(cleared.inFlight).toEqual([])
    expect(cleared.mode).toBe('check_out')
    expect(admitScan(cleared, 'u1')).toEqual({ admit: true })
  })
})

describe('changing what the scanner is for', () => {
  it('starts over, because results from another mode would misdescribe them', () => {
    // A row saying "Checked out" has no meaning in a check-in session.
    let session = emptySession('check_out')
    session = scan(session, 'u1')

    const switched = switchMode(session, 'check_in')
    expect(switched.mode).toBe('check_in')
    expect(switched.entries).toHaveLength(0)
  })

  it('leaves the session alone when the mode is unchanged', () => {
    let session = emptySession('check_out')
    session = scan(session, 'u1')

    expect(switchMode(session, 'check_out')).toBe(session)
  })

  it('knows which modes write', () => {
    expect(modeMutates('inspect')).toBe(false)
    expect(modeMutates('check_out')).toBe(true)
    expect(modeMutates('check_in')).toBe(true)
    expect(SCAN_MODES).toEqual(['inspect', 'check_out', 'check_in'])
  })
})

describe('what the session says at a glance', () => {
  it('counts each outcome', () => {
    let session = emptySession('check_out')
    session = scan(session, 'u1', 'success')
    session = scan(session, 'u2', 'success')
    session = scan(session, 'u3', 'warning')
    session = scan(session, 'u4', 'failed')
    session = beginScan(session, { unitId: 'u5', at: 9 })

    expect(sessionCounts(session)).toEqual({
      total: 5, success: 2, warning: 1, failed: 1, processing: 1,
    })
  })

  it('counts nothing in a fresh session', () => {
    expect(sessionCounts(emptySession('inspect'))).toEqual({
      total: 0, success: 0, warning: 0, failed: 0, processing: 0,
    })
  })
})

describe('the session never mutates what it was given', () => {
  it('leaves the previous value untouched', () => {
    // React state, so a mutated-in-place session would not re-render.
    const before = emptySession('check_out')
    const started = beginScan(before, { unitId: 'u1', at: 1 })
    const done = completeScan(started, { unitId: 'u1', outcome: 'success', message: 'ok' })

    expect(before.entries).toHaveLength(0)
    expect(started.entries[0]?.outcome).toBe('processing')
    expect(done.entries[0]?.outcome).toBe('success')
    expect(started.inFlight).toEqual(['u1'])
    expect(done.inFlight).toEqual([])
  })
})
