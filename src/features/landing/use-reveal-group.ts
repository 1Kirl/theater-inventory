import { useEffect, useState } from 'react'

/**
 * Scroll reveals, as one attribute and one observer per group.
 *
 * A group marks itself `data-revealed="true"` the first time it enters the
 * viewport; `landing.css` animates every `data-reveal` descendant from its own
 * offset and delay. Three consequences are the reason it is built this way:
 *
 * - There is one observer per section rather than one per element, and it
 *   disconnects the moment it fires. Nothing listens to scroll.
 * - An element reveals exactly once. Scrolling back up replays nothing, which
 *   is the flicker this pattern usually produces.
 * - The stagger is CSS `transition-delay`, so it costs no JavaScript at all and
 *   `prefers-reduced-motion` can switch the whole thing off in the stylesheet.
 *
 * The element is held in state rather than a ref because the ref callback is
 * what tells this hook the node exists. That also makes the returned `ref`
 * assignable to any intrinsic element, so a group can be a `<section>` or an
 * `<li>` where the markup calls for one.
 */

export interface RevealGroupProps {
  ref: (node: HTMLElement | null) => void
  'data-revealed': 'true' | 'false'
}

export function useRevealGroup(options?: { threshold?: number }): RevealGroupProps {
  const threshold = options?.threshold ?? 0.15
  const [node, setNode] = useState<HTMLElement | null>(null)

  // Without an observer there is no event that would ever reveal anything, so
  // such an environment starts revealed rather than staying at opacity zero.
  // Settled during the first render; discovering it in an effect would mean a
  // render spent invisible first.
  const [revealed, setRevealed] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (node === null || revealed) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      // A short bottom inset so a section starts moving once it is properly on
      // screen rather than the instant its first pixel appears.
      { threshold, rootMargin: '0px 0px -8% 0px' },
    )

    observer.observe(node)
    return () => { observer.disconnect() }
  }, [node, revealed, threshold])

  return { ref: setNode, 'data-revealed': revealed ? 'true' : 'false' }
}
