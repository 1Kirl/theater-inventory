import { describe, expect, it } from 'vitest'
import {
  POINTER_X_PROPERTY, POINTER_Y_PROPERTY, pointerOffsetOf,
} from '@/features/landing/use-pointer-depth'

/**
 * Where the pointer is, as the hero's layers understand it.
 *
 * The number is multiplied by a share of the page's depth budget, so anything
 * escaping -1..1 does not fail here — it throws a screenshot off the page under
 * a fast cursor. That bound is the whole contract.
 */

const box = { left: 100, top: 50, width: 400, height: 200 }

describe('pointerOffsetOf', () => {
  it('is zero at the centre', () => {
    expect(pointerOffsetOf({ x: 300, y: 150 }, box)).toEqual({ x: 0, y: 0 })
  })

  it('reaches exactly one at each edge', () => {
    expect(pointerOffsetOf({ x: 100, y: 50 }, box)).toEqual({ x: -1, y: -1 })
    expect(pointerOffsetOf({ x: 500, y: 250 }, box)).toEqual({ x: 1, y: 1 })
  })

  it('clamps a pointer that has left the box', () => {
    // `pointerleave` resets, but a fast cursor can report a position outside
    // the element before it arrives.
    const far = pointerOffsetOf({ x: -9000, y: 9000 }, box)
    expect(far).toEqual({ x: -1, y: 1 })
  })

  it('never leaves -1..1 anywhere', () => {
    for (const x of [-5000, 0, 100, 300, 500, 5000]) {
      for (const y of [-5000, 0, 50, 150, 250, 5000]) {
        const offset = pointerOffsetOf({ x, y }, box)
        expect(Math.abs(offset.x), `x ${x}`).toBeLessThanOrEqual(1)
        expect(Math.abs(offset.y), `y ${y}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('survives a degenerate box rather than dividing by zero', () => {
    expect(pointerOffsetOf({ x: 10, y: 10 }, { left: 0, top: 0, width: 0, height: 0 }))
      .toEqual({ x: 0, y: 0 })
  })

  it('names the properties the stylesheet reads', () => {
    expect(POINTER_X_PROPERTY).toBe('--pointer-x')
    expect(POINTER_Y_PROPERTY).toBe('--pointer-y')
  })
})
