import { describe, expect, it } from 'vitest'
import { SCROLL_PROGRESS_PROPERTY, scrollProgressOf } from '@/features/landing/use-scroll-progress'

/**
 * The arithmetic the scroll-driven sections will be built on.
 *
 * The hook itself is plumbing — an observer, a frame, a style write — and this
 * project has no DOM to mount it in. What is worth pinning is the number it
 * writes, because every future rule multiplies it: a value that escaped 0..1
 * would not fail here, it would fling a screenshot off the page somewhere in
 * Phase C.
 */

const rect = (top: number, height: number) => ({ top, height })

describe('scrollProgressOf', () => {
  const viewport = 800

  it('is zero when the section has not entered yet', () => {
    // Top edge exactly at the bottom of the viewport: the first visible pixel.
    expect(scrollProgressOf(rect(800, 600), viewport)).toBe(0)
  })

  it('is one when the section has fully left', () => {
    // Bottom edge at the top of the viewport: the last visible pixel.
    expect(scrollProgressOf(rect(-600, 600), viewport)).toBe(1)
  })

  it('is one half at the midpoint of the travel', () => {
    // Travel is height + viewport = 1400; halfway is 700 past the start.
    expect(scrollProgressOf(rect(100, 600), viewport)).toBeCloseTo(0.5, 5)
  })

  it('never leaves 0..1, however far past the section the page is scrolled', () => {
    for (const top of [5000, 800, 0, -600, -5000, -100000]) {
      const progress = scrollProgressOf(rect(top, 600), viewport)
      expect(progress, `top ${top}`).toBeGreaterThanOrEqual(0)
      expect(progress, `top ${top}`).toBeLessThanOrEqual(1)
    }
  })

  it('rises monotonically as the page scrolls down', () => {
    // Anything reading this expects it to only ever move one way through a
    // section; a rule that eased on it would otherwise stutter.
    const tops = [800, 600, 400, 200, 0, -200, -400, -600]
    const values = tops.map((top) => scrollProgressOf(rect(top, 600), viewport))

    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!, `step ${i}`).toBeGreaterThanOrEqual(values[i - 1]!)
    }
  })

  it('spans the full range for a section taller than the viewport', () => {
    const tall = 2400
    expect(scrollProgressOf(rect(viewport, tall), viewport)).toBe(0)
    expect(scrollProgressOf(rect(-tall, tall), viewport)).toBe(1)
  })

  it('spans the full range for a section shorter than the viewport', () => {
    const short = 200
    expect(scrollProgressOf(rect(viewport, short), viewport)).toBe(0)
    expect(scrollProgressOf(rect(-short, short), viewport)).toBe(1)
  })

  it('survives a degenerate measurement rather than producing a bad transform', () => {
    // A zero-height section, or a rect read mid-resize before layout settles.
    expect(scrollProgressOf(rect(0, 0), 0)).toBe(0)
    expect(scrollProgressOf(rect(Number.NaN, 600), viewport)).toBe(0)
    expect(scrollProgressOf(rect(0, Number.NaN), viewport)).toBe(0)
  })

  it('names the property the stylesheet reads', () => {
    // The one string shared between the hook and `landing.css`.
    expect(SCROLL_PROGRESS_PROPERTY).toBe('--scroll-progress')
  })
})
