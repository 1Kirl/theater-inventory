import { useEffect, useState } from 'react'

/**
 * How far a section has travelled through the viewport, as 0 to 1.
 *
 * The foundation the scroll-driven sections are built on: a sticky panel that
 * changes as you read past it, a screenshot that separates from its stack, a
 * progress line that fills. All of them need the same number, and none of them
 * should each be running their own scroll listener to get it.
 *
 * Three things shape the implementation, and each is a cost this page refuses
 * to pay:
 *
 * - **Nothing subscribes while the section is off screen.** An
 *   `IntersectionObserver` starts the loop when the section approaches and
 *   stops it when it leaves, so a page of eleven sections is never running
 *   eleven scroll loops. Only what is on screen costs anything.
 *
 * - **The value never passes through React.** It is written straight onto the
 *   element as a custom property, so a scroll produces a style write rather
 *   than a render of the section and everything inside it. Sixty renders a
 *   second is how a page like this becomes slow on a phone.
 *
 * - **Reading and writing happen once per frame.** `requestAnimationFrame`
 *   coalesces a burst of scroll events into one measurement, and the read
 *   (`getBoundingClientRect`) happens before the write, so the two never
 *   interleave into layout thrashing.
 *
 * Reduced motion is deliberately *not* handled here. This module has no
 * business reading a media query at all — the project bans that API across
 * source, and the preference belongs to the stylesheet. The variable is always
 * written; `landing.css` decides whether anything moves, and under reduced
 * motion it resolves the depth budget to zero so a progress-driven rule lands
 * on its final, readable state.
 */

/** The custom property every scroll-driven rule reads. */
export const SCROLL_PROGRESS_PROPERTY = '--scroll-progress'

/**
 * Start the loop before the section arrives and stop it after it leaves, so a
 * section is never caught mid-scroll with a stale value.
 */
const ROOT_MARGIN = '20% 0px 20% 0px'

export interface ScrollProgressRect {
  top: number
  height: number
}

/**
 * Where a section sits in its own travel through the viewport.
 *
 * Zero the moment its top edge reaches the bottom of the viewport, one when its
 * bottom edge reaches the top: the whole time any part of it is visible. Pure,
 * and exported, because this is the part worth testing — the rest is plumbing.
 *
 * A section taller than the viewport still spans the full range; a section
 * shorter than it does too. The denominator is the distance the section
 * actually travels, which is its own height plus the viewport it crosses.
 *
 * Always clamped. A caller reading this mid-flight during a resize, or a
 * degenerate zero-height section, gets a number in range rather than a
 * transform flung off screen.
 */
export function scrollProgressOf(rect: ScrollProgressRect, viewportHeight: number): number {
  const travel = rect.height + viewportHeight
  if (travel <= 0) return 0

  const progress = (viewportHeight - rect.top) / travel

  if (!Number.isFinite(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

/**
 * Attach to a section to have `--scroll-progress` maintained on it.
 *
 * Returns a ref callback rather than a value, because the value is not for
 * JavaScript to read: it is for CSS. A component that genuinely needs the
 * number in React can read the property off the node.
 *
 * The node is held in state rather than a ref for the same reason
 * `useRevealGroup` does it — the ref callback is what tells the hook the
 * element exists, and state is what re-runs the effect when it does.
 */
export function useScrollProgress(): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (node === null) return
    // Without an observer there is no way to know when the section is on
    // screen, and a permanent scroll listener is exactly what this avoids. The
    // section simply stays at its starting value, which every rule is written
    // to be readable at.
    if (typeof IntersectionObserver === 'undefined') return

    let frame = 0
    let active = false

    const measure = () => {
      frame = 0
      const rect = node.getBoundingClientRect()
      const progress = scrollProgressOf(rect, window.innerHeight)
      // One write, after the read. Never interleaved.
      node.style.setProperty(SCROLL_PROGRESS_PROPERTY, progress.toFixed(4))
    }

    const schedule = () => {
      // Already queued: a burst of scroll events costs one measurement, not one
      // each.
      if (frame !== 0) return
      frame = requestAnimationFrame(measure)
    }

    const start = () => {
      if (active) return
      active = true
      window.addEventListener('scroll', schedule, { passive: true })
      window.addEventListener('resize', schedule, { passive: true })
      // Once immediately, so a section that is already on screen at load is
      // correct before the first scroll rather than after it.
      schedule()
    }

    const stop = () => {
      if (!active) return
      active = false
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting)
        if (visible) start()
        else {
          stop()
          // Left the viewport: settle at the end it left by, so a rule reading
          // this finds a finished state rather than whatever the last frame
          // happened to catch.
          const rect = node.getBoundingClientRect()
          node.style.setProperty(
            SCROLL_PROGRESS_PROPERTY,
            rect.top > 0 ? '0' : '1',
          )
        }
      },
      { rootMargin: ROOT_MARGIN },
    )

    observer.observe(node)

    return () => {
      observer.disconnect()
      stop()
    }
  }, [node])

  return setNode
}
