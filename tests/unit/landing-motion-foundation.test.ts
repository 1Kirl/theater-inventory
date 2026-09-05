import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The promises the motion foundation makes to the sections built on it.
 *
 * Phase A adds no visible animation. What it adds is a set of guarantees the
 * later phases will assume without re-checking — that a scroll-driven section
 * costs nothing off screen, that reduced motion switches all of it off from one
 * place, and that none of it arrived with a dependency. Those are exactly the
 * things that fail quietly, months later, in a diff about something else.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const css = read('features/landing/landing.css')
const hook = read('features/landing/use-scroll-progress.ts')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

describe('the motion tokens are one vocabulary', () => {
  it('names every value a section is expected to reuse', () => {
    for (const token of [
      '--landing-duration-micro',
      '--landing-duration-reveal',
      '--landing-duration-media',
      '--landing-stagger',
      '--landing-distance-reveal',
      '--landing-distance-text',
      '--landing-depth',
    ]) {
      expect(css, token).toContain(`${token}:`)
    }
  })

  it('keeps the values the page already animates at', () => {
    // Read off the existing reveal rather than invented beside it. Changing
    // these is a design decision, not a refactor.
    expect(css).toContain('--landing-duration-reveal: 700ms')
    expect(css).toContain('--landing-distance-reveal: 28px')
    expect(css).toContain('--landing-stagger: 90ms')
  })

  it('declares the scroll variable so a rule reading it always finds a number', () => {
    // An undefined custom property inside calc() invalidates the whole
    // declaration — that fails as broken layout, not as no animation.
    expect(css).toMatch(/--scroll-progress:\s*0/)
  })
})

describe('scroll work happens only where it is visible', () => {
  it('subscribes through an observer rather than permanently', () => {
    expect(hook).toContain('IntersectionObserver')
    expect(hook).toContain("addEventListener('scroll'")
    expect(hook).toContain("removeEventListener('scroll'")
  })

  it('coalesces a burst of scroll events into one measurement', () => {
    expect(hook).toContain('requestAnimationFrame')
    expect(hook).toContain('cancelAnimationFrame')
    // A polling timer would run whether or not anything scrolled.
    expect(hook).not.toContain('setInterval')
  })

  it('cleans up everything it started', () => {
    const effect = hook.slice(hook.indexOf('useEffect'))
    const cleanup = effect.slice(effect.indexOf('return () => {'))

    expect(cleanup).toContain('observer.disconnect()')
    expect(cleanup).toContain('stop()')
  })

  it('writes to the element instead of through React', () => {
    // Sixty renders a second of a section and its whole subtree is how a page
    // like this becomes slow on a phone.
    expect(hook).toContain('style.setProperty')
    expect(hook).not.toMatch(/setProgress|useState<number>/)
  })

  it('reads the layout before it writes, never interleaved', () => {
    const measure = hook.slice(hook.indexOf('const measure'))
    const body = measure.slice(0, measure.indexOf('\n    }'))

    expect(body.indexOf('getBoundingClientRect'))
      .toBeLessThan(body.indexOf('setProperty'))
  })
})

describe('reduced motion switches the whole system off from one place', () => {
  it('zeroes the depth budget, so no scroll-driven rule needs its own branch', () => {
    expect(reduced).toContain('--landing-depth: 0px')
  })

  it('resolves depth, hover and media to their readable states', () => {
    for (const selector of ['.landing-depth', '.landing-lift', '.landing-media']) {
      expect(reduced, selector).toContain(selector)
    }
    // Media must be visible, not merely un-animated: content may never depend
    // on an animation to appear.
    const media = reduced.slice(reduced.indexOf('.landing-media {'))
    expect(media.slice(0, 200)).toContain('opacity: 1')
  })

  it('leaves the reveal and marquee fallbacks exactly as they were', () => {
    expect(reduced).toContain('[data-reveal]')
    expect(reduced).toContain('.landing-drift')
    expect(reduced).toContain('.landing-marquee__track')
    // Motionless still means reachable: the strip becomes a row you scroll.
    expect(reduced).toContain('overflow-x: auto')
  })
})

describe('the foundation animates transform and opacity, and little else', () => {
  it('adds no continuously animated expensive property', () => {
    // `clip-path` transitions on a media swap, which is a discrete event, not a
    // scroll-driven loop. Blur and filter are what this is guarding against.
    expect(css).not.toMatch(/transition:[^;]*\bfilter\b/)
    expect(css).not.toMatch(/animation:[^;]*\bblur\b/)
  })

  it('promotes only what actually moves on scroll', () => {
    // `will-change` on everything is its own performance problem.
    expect((css.match(/will-change:/g) ?? []).length).toBeLessThanOrEqual(2)
  })
})

describe('Phase A stayed infrastructure', () => {
  it('added no animation dependency', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })

    for (const banned of ['gsap', 'framer-motion', 'motion', 'lenis', '@studio-freight/lenis']) {
      expect(all, banned).not.toContain(banned)
    }
  })

  it('applies the new primitives to nothing yet', () => {
    // Phase A is meant to be invisible. A section reaching for these before its
    // own phase is how "foundation only" quietly becomes a redesign.
    const sections = readFileSync(
      path.join(src, 'features/landing/LandingPage.tsx'), 'utf8',
    )
    expect(sections).not.toContain('landing-depth')
    expect(sections).not.toContain('landing-lift')
    expect(sections).not.toContain('useScrollProgress')
  })
})
