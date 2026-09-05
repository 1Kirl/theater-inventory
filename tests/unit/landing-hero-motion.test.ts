import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The hero's entrance, and the rules it is not allowed to break.
 *
 * This is the one section on the page with choreography of its own, which makes
 * it the one place the shared guarantees are easiest to lose: a pointer
 * listener that outlives the component, a media query read in JavaScript where
 * the project forbids it, motion that a reduced-motion visitor still gets.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const hero = read('features/landing/HeroSection.tsx')
const pointer = read('features/landing/use-pointer-depth.ts')
const css = read('features/landing/landing.css')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

/** Delay in ms for a hero step, read from its rule in the stylesheet. */
function delayOf(className: string): number {
  const rule = css.match(new RegExp(`\\.${className}\\s*\\{[^}]*--reveal-delay:\\s*(\\d+)ms`))
  return rule ? Number(rule[1]) : Number.NaN
}

describe('the hero arrives as a sequence, not all at once', () => {
  const order = ['hero-eyebrow', 'hero-line-1', 'hero-line-2', 'hero-copy', 'hero-actions', 'hero-screen']

  it('gives each step its own delay', () => {
    for (const step of order) {
      expect(delayOf(step), step).not.toBeNaN()
    }
  })

  it('runs them in the order the eye should read them', () => {
    const delays = order.map(delayOf)
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!, `${order[i]} after ${order[i - 1]}`).toBeGreaterThan(delays[i - 1]!)
    }
  })

  it('finishes quickly enough to be an entrance rather than an intro', () => {
    // Last step starts, plus its own duration. Past roughly two seconds a
    // visitor is waiting on the page instead of reading it.
    const screenDuration = Number(
      css.match(/\.hero-screen\s*\{[^}]*--reveal-duration:\s*(\d+)ms/)?.[1] ?? NaN,
    )
    expect(delayOf('hero-screen') + screenDuration).toBeLessThanOrEqual(1800)
  })

  it('does not simply reuse the page-wide reveal for every element', () => {
    // The failure this guards: assigning reveal-d1..d5 to the same five
    // elements and calling it choreography.
    expect(hero).not.toMatch(/reveal-d[1-5]/)
    expect(hero).toContain('hero-line-1')
    expect(hero).toContain('hero-line-2')
  })

  it('gives the headline a shorter travel than a section block', () => {
    const line = css.match(/\.hero-line\s*\{[^}]*--reveal-y:\s*(\d+)px/)?.[1]
    expect(Number(line)).toBeLessThanOrEqual(20)
  })

  it('brings the product in with depth', () => {
    const screen = css.slice(css.indexOf('.landing-root .hero-screen'))
    const block = screen.slice(0, screen.indexOf('}'))

    expect(block).toMatch(/--reveal-y:\s*20px/)
    expect(block).toMatch(/--reveal-scale:\s*0\.96/)
  })
})

describe('the product sits on a plane, not a page', () => {
  it('puts decorative panels behind it without inventing media slots', () => {
    expect(hero).toContain('hero-panel-back')
    expect(hero).toContain('hero-panel-mid')
    // Still exactly one media slot, as before. The layering came from
    // decoration; adding placeholders to animate would be paying for depth in
    // screenshots somebody then has to produce.
    expect((hero.match(/<MediaPlaceholder/g) ?? []).length).toBe(1)
  })

  it('moves the layers by different amounts', () => {
    const screen = Number(css.match(/\.hero-layer-screen\s*\{\s*--layer-depth:\s*([\d.]+)/)?.[1])
    const panels = Number(css.match(/\.hero-layer-panels\s*\{\s*--layer-depth:\s*([\d.]+)/)?.[1])

    // What is behind moves more; that difference is the depth.
    expect(panels).toBeGreaterThan(screen)
    expect(panels).toBeLessThanOrEqual(1)
  })

  it('leaves the text alone', () => {
    // Moving a headline under the cursor makes it harder to read and buys
    // nothing.
    expect(css).not.toMatch(/\.hero-(copy|line|eyebrow)[^{]*\{[^}]*--pointer-/)
  })
})

describe('pointer depth stays inside its budget', () => {
  it('is a share of the page depth rather than its own pixel value', () => {
    const layer = css.slice(css.indexOf('.landing-root .hero-layer {'))
    const block = layer.slice(0, layer.indexOf('}'))

    expect(block).toContain('var(--landing-depth)')
    expect(block).toContain('var(--pointer-x')
    expect(block).toContain('var(--scroll-progress)')
  })

  it('keeps the pointer contribution near the approved eight pixels', () => {
    // depth budget 40px x largest layer share x the pointer's own factor.
    const budget = Number(css.match(/--landing-depth:\s*(\d+)px/)?.[1])
    const largest = Number(css.match(/\.hero-layer-panels\s*\{\s*--layer-depth:\s*([\d.]+)/)?.[1])
    const factor = Number(
      css.match(/var\(--pointer-x[^)]*\)\s*\*\s*var\(--layer-depth[^)]*\)\s*\*\s*var\(--landing-depth\)\s*\*\s*([\d.]+)/)?.[1],
    )

    expect(budget * largest * factor).toBeLessThanOrEqual(8.5)
  })

  it('never runs off a touch screen', () => {
    // Two independent guards: the event is filtered by pointer type, and the
    // stylesheet zeroes the variables where there is no fine pointer.
    expect(pointer).toContain("event.pointerType !== 'mouse'")
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\)/)
  })
})

describe('the pointer listener is cheap and temporary', () => {
  it('never pushes a frame through React', () => {
    expect(pointer).toContain('style.setProperty')
    expect(pointer).not.toMatch(/useState<\{|setOffset|setPointer\b/)
  })

  it('coalesces events into one frame and cancels the pending one', () => {
    expect(pointer).toContain('requestAnimationFrame')
    expect(pointer).toContain('cancelAnimationFrame')
    expect(pointer).not.toContain('setInterval')
  })

  it('removes both listeners when the hero unmounts', () => {
    const cleanup = pointer.slice(pointer.lastIndexOf('return () => {'))
    expect(cleanup).toContain("removeEventListener('pointermove'")
    expect(cleanup).toContain("removeEventListener('pointerleave'")
    expect(cleanup).toContain('cancelAnimationFrame')
  })

  it('reads the layout before writing to it', () => {
    const apply = pointer.slice(pointer.indexOf('const apply'))
    const body = apply.slice(0, apply.indexOf('\n    }'))
    expect(body.indexOf('getBoundingClientRect')).toBeLessThan(body.indexOf('pointerOffsetOf'))
  })

  it('reads no media query in JavaScript', () => {
    for (const file of [pointer, hero, read('features/landing/use-scroll-progress.ts')]) {
      expect(file).not.toContain('matchMedia')
    }
  })
})

describe('the background is atmosphere, not activity', () => {
  it('drifts slowly enough not to be noticed', () => {
    const durations = [...css.matchAll(/animation:\s*hero-drift-[ab]\s+(\d+)s/g)]
      .map((m) => Number(m[1]))

    expect(durations).toHaveLength(2)
    for (const seconds of durations) {
      expect(seconds).toBeGreaterThanOrEqual(60)
    }
  })

  it('animates transform only, and never a filter', () => {
    const keyframes = css.slice(css.indexOf('@keyframes hero-drift-a'))
    expect(keyframes).toContain('transform: translate3d')
    expect(keyframes).not.toContain('filter')
    // A large animated blur is one of the most expensive things a page can do.
    expect(css).not.toMatch(/\.hero-blob[^{]*\{[^}]*filter:/)
  })

  it('runs on desktop widths only', () => {
    const gate = css.slice(css.indexOf('@media (min-width: 768px)'))
    expect(gate.slice(0, 240)).toContain('hero-drift-a')
  })
})

describe('reduced motion leaves a finished hero, not a still one', () => {
  it('stops the entrance, the layers and the drift', () => {
    expect(reduced).toContain('.hero-layer')
    expect(reduced).toContain('.hero-blob')
    // Zeroing the shared budget is what already disables pointer and scroll.
    expect(reduced).toContain('--landing-depth: 0px')
  })

  it('leaves every hero element visible', () => {
    // `[data-reveal]` is forced to opacity 1 for the whole page, which covers
    // the eyebrow, both headline lines, the copy, the actions and the screen.
    expect(reduced).toMatch(/\[data-reveal\][^}]*opacity:\s*1/s)
  })
})

describe('Phase B changed only the hero', () => {
  it('added no animation dependency', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>
    }
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const banned of ['gsap', 'framer-motion', 'motion', 'lenis']) {
      expect(all, banned).not.toContain(banned)
    }
  })

  it('left the other sections on the shared reveal', () => {
    for (const section of ['StorySection', 'WorkspaceSection', 'FeatureShowcase']) {
      const text = read(`features/landing/${section}.tsx`)
      expect(text, section).not.toContain('hero-')
      expect(text, section).not.toContain('usePointerDepth')
    }
  })
})
