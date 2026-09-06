import { useEffect, useState } from 'react'

/**
 * Where the pointer is inside an element, as -1 to 1 on each axis.
 *
 * The hero's layers lean very slightly toward the cursor. It is the difference
 * between a picture of an application and something sitting on the page, and it
 * only works while it stays under the threshold of being noticed — which is why
 * the displacement is a fraction of one shared depth budget rather than a
 * number chosen here.
 *
 * Built to the same three rules as `useScrollProgress`, for the same reasons:
 * nothing is subscribed unless the pointer is actually over the element, the
 * value is written to the node as a custom property rather than pushed through
 * React, and a burst of pointer events costs one measurement per frame.
 *
 * Touch is excluded at the source. A `pointermove` on a phone fires only during
 * a drag, and reacting to it would make the hero twitch while somebody is
 * trying to scroll past it, so only a mouse is listened to. That check is on
 * the event itself — this project bans media-query APIs in source, and the
 * capability question belongs to the stylesheet anyway: `landing.css` gates
 * whether the variables are consumed at all.
 */

export const POINTER_X_PROPERTY = '--pointer-x'
export const POINTER_Y_PROPERTY = '--pointer-y'

/**
 * The pointer's position within a box, centred and clamped.
 *
 * Zero at the middle, ±1 at the edges. Exported because it is the part with an
 * answer worth checking; the rest is listeners.
 */
export function pointerOffsetOf(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const axis = (value: number, start: number, size: number): number => {
    if (size <= 0) return 0
    const ratio = ((value - start) / size) * 2 - 1
    if (!Number.isFinite(ratio)) return 0
    return Math.min(1, Math.max(-1, ratio))
  }

  return {
    x: axis(point.x, rect.left, rect.width),
    y: axis(point.y, rect.top, rect.height),
  }
}

export function usePointerDepth(): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (node === null) return

    let frame = 0
    let pending: { x: number; y: number } | null = null

    const write = (x: number, y: number) => {
      node.style.setProperty(POINTER_X_PROPERTY, x.toFixed(3))
      node.style.setProperty(POINTER_Y_PROPERTY, y.toFixed(3))
    }

    const apply = () => {
      frame = 0
      if (!pending) return
      // Read after the event, once per frame, and never interleaved with the
      // write below it.
      const rect = node.getBoundingClientRect()
      const offset = pointerOffsetOf(pending, rect)
      write(offset.x, offset.y)
    }

    const onMove = (event: PointerEvent) => {
      // A finger dragging the page past the hero must not move it.
      if (event.pointerType !== 'mouse') return
      pending = { x: event.clientX, y: event.clientY }
      if (frame !== 0) return
      frame = requestAnimationFrame(apply)
    }

    const onLeave = () => {
      pending = null
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      // Back to neutral, so the layers settle rather than stopping wherever the
      // cursor happened to leave.
      write(0, 0)
    }

    node.addEventListener('pointermove', onMove, { passive: true })
    node.addEventListener('pointerleave', onLeave, { passive: true })

    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [node])

  return setNode
}
