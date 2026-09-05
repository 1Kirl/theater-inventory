import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GLYPH_RADIUS_RATIO, NARROW_VIEWPORT, PHYSICS, STATIC_PROP_COUNT, THEATER_PROPS,
  densityFor, nextDropDelay, spawnFor,
} from '@/features/landing/theater-props'

/**
 * Production equipment falling behind the page, under vellum.
 *
 * The parts worth holding are the ones that would fail quietly: a physics
 * engine that leaks into the rest of the page or the rest of the app, a body
 * count that climbs for as long as a tab stays open, a loop that keeps running
 * for nobody, and a decorative layer that starts taking clicks meant for a
 * button. The density and spawn policy is pure and checked directly; the engine
 * and the DOM are checked by reading the source, which is the only thing a
 * node-only suite can do about them.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const component = read('features/landing/FallingTheaterProps.tsx')
/** Code only: several assertions are about words the comments also use. */
const code = component.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const css = read('features/landing/landing.css')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
/** Just the atmosphere's own rules. */
const atmosphere = css.slice(css.indexOf('atmosphere */'), css.indexOf('typography */'))

/** The rules for one selector, without the neighbours that follow it. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(selector)
  expect(at, selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('\n}', at) + 2)
}

describe('the physics stays where it was put', () => {
  it('is reached from one file, and only that file', () => {
    const landing = path.join(src, 'features/landing')
    const importers = readdirSync(landing)
      .filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'))
      .filter((f) => readFileSync(path.join(landing, f), 'utf8').includes('matter-js'))

    expect(importers).toEqual(['FallingTheaterProps.tsx'])
  })

  it('does not reach the rest of the application', () => {
    // A grep over src/, so a stray import anywhere outside the landing page
    // fails here rather than in a Dashboard bundle.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          if (readFileSync(full, 'utf8').includes('matter-js')) {
            offenders.push(path.relative(src, full))
          }
        }
      }
    }
    walk(src)
    expect(offenders).toEqual(['features/landing/FallingTheaterProps.tsx'])
  })

  it('arrives as its own chunk rather than on the critical path', () => {
    expect(code).toContain("await import('matter-js')")
    expect(code).not.toMatch(/^import .* from 'matter-js'/m)
  })

  it('renders no canvas and never asks Matter to draw', () => {
    for (const banned of ['Matter.Render', 'Render.create', 'canvas', 'getContext', 'WebGL']) {
      expect(code, banned).not.toContain(banned)
    }
  })

  it('leaves the other landing motion systems alone', () => {
    for (const file of ['HeroSection.tsx', 'ProductShowcase.tsx', 'HowItWorksSection.tsx']) {
      expect(read(`features/landing/${file}`), file).not.toContain('matter-js')
    }
  })

  it('adds no animation library beyond the engine', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies)).toContain('matter-js')
    for (const banned of ['gsap', 'framer-motion', 'motion', 'lenis', 'three', 'p5']) {
      expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }), banned).not.toContain(banned)
    }
  })
})

describe('the props are DOM, decorative, and inert', () => {
  it('draws each prop as text in a span', () => {
    expect(component).toMatch(/<span[\s\S]{0,900}\{record\.prop\}[\s\S]{0,40}<\/span>/)
  })

  it('uses whatever emoji font the platform already has', () => {
    expect(css).toContain("'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif")
    expect(css).not.toContain('@font-face')
  })

  it('carries only production equipment', () => {
    expect(THEATER_PROPS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(THEATER_PROPS).size).toBe(THEATER_PROPS.length)
  })

  it('takes no click, caret, or tab stop', () => {
    const block = rule(atmosphere, '.landing-root .landing-atmosphere,')

    expect(block).toContain('pointer-events: none')
    expect(block).toContain('user-select: none')
    expect(block).toContain('position: fixed')
    expect((component.match(/aria-hidden="true"/g) ?? []).length).toBe(2)
    for (const focusable of ['tabIndex', '<button', '<a ', 'onClick']) {
      expect(code, focusable).not.toContain(focusable)
    }
  })
})

describe('the world is bounded, and so is the pile', () => {
  it('builds a floor and two walls, and rebuilds rather than leaks them', () => {
    const build = code.slice(code.indexOf('function buildBounds'))
    expect((build.slice(0, build.indexOf('return walls')).match(/Bodies\.rectangle/g) ?? []).length).toBe(3)
    // A resize that adds walls without removing the old ones leaves an
    // invisible shelf for bodies to rest on.
    expect(code).toContain('Composite.remove(engine.world, bounds)')
  })

  it('never lets the body count climb', () => {
    expect(code).toMatch(/while \(bodies\.size >= policy\.maximum\) recycleOldest\(\)/)
  })

  it('recycles the body, the node, and the record together', () => {
    const recycle = code.slice(code.indexOf('function recycleOldest'))
    const block = recycle.slice(0, recycle.indexOf('\n      }'))

    expect(block).toContain('Composite.remove')
    expect(block).toContain('bodies.delete')
    expect(block).toContain('nodesRef.current.delete')
    expect(block).toContain('setProps')
  })

  it('lets props collide with each other', () => {
    // No collision filter and no sensor: every prop is a solid body in one
    // world, which is what makes a pile a pile.
    expect(code).not.toContain('collisionFilter')
    expect(code).not.toContain('isSensor')
  })

  it('lets a settled pile stop being simulated', () => {
    expect(code).toContain('enableSleeping: true')
    expect(PHYSICS.sleepThreshold).toBeGreaterThan(0)
  })
})

describe('the density policy', () => {
  it('thins out on a narrow viewport', () => {
    const phone = densityFor(NARROW_VIEWPORT - 1)
    const desktop = densityFor(NARROW_VIEWPORT + 1)

    expect(phone.initial).toBeLessThan(desktop.initial)
    expect(phone.maximum).toBeLessThan(desktop.maximum)
    expect(phone.maxSize).toBeLessThan(desktop.maxSize)
    // Less continuous activity, not just fewer objects.
    expect(phone.minInterval).toBeGreaterThan(desktop.minInterval)
  })

  it('stays inside the counts the phase set', () => {
    const phone = densityFor(390)
    const desktop = densityFor(1440)

    expect(phone.initial).toBeGreaterThanOrEqual(4)
    expect(phone.initial).toBeLessThanOrEqual(6)
    expect(phone.maximum).toBeGreaterThanOrEqual(phone.initial)
    expect(phone.maximum).toBeLessThanOrEqual(7)

    expect(desktop.initial).toBeGreaterThanOrEqual(8)
    expect(desktop.initial).toBeLessThanOrEqual(12)
    expect(desktop.maximum).toBeGreaterThanOrEqual(desktop.initial)
    expect(desktop.maximum).toBeLessThanOrEqual(16)
  })

  it('drops one every seven to fourteen seconds on a desktop', () => {
    const policy = densityFor(1440)
    expect(policy.minInterval).toBeGreaterThanOrEqual(7_000)
    expect(policy.maxInterval).toBeLessThanOrEqual(14_000)

    const delays = Array.from({ length: 40 }, (_, i) => nextDropDelay(policy, () => i / 40))
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(policy.minInterval)
    expect(Math.max(...delays)).toBeLessThanOrEqual(policy.maxInterval)
  })

  it('reads the width rather than the user agent', () => {
    expect(code).toContain('window.innerWidth')
    expect(component).not.toContain('navigator.userAgent')
    expect(component).not.toContain('matchMedia')
  })
})

describe('every prop starts somewhere different', () => {
  const policy = densityFor(1440)

  it('begins above the viewport, inside the walls', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const s = spawnFor(1440, policy, () => r)
      expect(s.y, `y at ${r}`).toBeLessThan(0)
      expect(s.x, `x at ${r}`).toBeGreaterThanOrEqual(0)
      expect(s.x, `x at ${r}`).toBeLessThanOrEqual(1440)
    }
  })

  it('varies size, angle, drift and spin', () => {
    const seq = [0.1, 0.9, 0.3, 0.7, 0.5]
    let i = 0
    const random = () => seq[i++ % seq.length]!
    const spawns = Array.from({ length: 8 }, () => spawnFor(1440, policy, random))

    expect(new Set(spawns.map((s) => s.size)).size).toBeGreaterThan(1)
    expect(new Set(spawns.map((s) => s.angle)).size).toBeGreaterThan(1)
    expect(spawns.every((s) => s.size >= policy.minSize && s.size <= policy.maxSize)).toBe(true)
  })

  it('keeps the spin gentle', () => {
    // Extremes of the range, so the widest possible nudge is still restrained.
    for (const r of [0, 1]) {
      const s = spawnFor(1440, policy, () => r)
      expect(Math.abs(s.angularVelocity)).toBeLessThanOrEqual(0.03)
      expect(Math.abs(s.velocityX)).toBeLessThanOrEqual(0.6)
    }
  })

  it('sizes the body to the drawn glyph, not the em box', () => {
    // An emoji paints well outside its em box; a body of size/2 lets the
    // artwork hang below the floor it is supposedly resting on.
    expect(GLYPH_RADIUS_RATIO).toBeGreaterThan(0.5)
    expect(code).toContain('state.size * GLYPH_RADIUS_RATIO')
  })

  it('does not release the whole cascade on one frame', () => {
    expect(code).toMatch(/setTimeout\(drop, at\)/)
    expect(code).toContain('CASCADE_MS')
  })
})

describe('one loop, and no React state inside it', () => {
  it('runs a single animation frame loop', () => {
    expect((code.match(/requestAnimationFrame\(/g) ?? []).length).toBe(2) // start + reschedule
    expect(code).not.toContain('setInterval')
  })

  it('writes transforms, never layout properties', () => {
    const place = code.slice(code.indexOf('function place('))
    const block = place.slice(0, place.indexOf('\n      }'))

    expect(block).toContain('style.transform')
    expect(block).toContain('translate3d')
    for (const layout of ['style.top', 'style.left', 'style.width', 'style.height']) {
      expect(code, layout).not.toContain(layout)
    }
  })

  it('sets no state per frame', () => {
    const loop = code.slice(code.indexOf('const step = (now: number)'), code.indexOf('live.frame = requestAnimationFrame(step)\n'))
    expect(loop).not.toContain('setProps')
    expect(loop).not.toContain('useState')
  })

  it('reads no layout in the loop', () => {
    const loop = code.slice(code.indexOf('const step = (now: number)'))
    for (const measure of ['getBoundingClientRect', 'offsetTop', 'offsetHeight', 'getComputedStyle']) {
      expect(loop.slice(0, loop.indexOf('live.frame = requestAnimationFrame(step)')), measure)
        .not.toContain(measure)
    }
  })

  it('steps no further than the engine stays stable at', () => {
    // Matter warns on the console for every step above this, and the solver
    // does come apart above it.
    expect(code).toContain('Math.min(now - last, 16.667)')
  })
})

describe('nothing runs for nobody', () => {
  it('stops stepping while the tab is hidden', () => {
    expect(code).toMatch(/if \(document\.hidden\) \{ last = now; return \}/)
  })

  it('holds the entrance until the page is actually looked at', () => {
    expect(code).toContain("document.addEventListener('visibilitychange', onVisible)")
  })

  it('schedules the next drop rather than queuing missed ones', () => {
    const sched = code.slice(code.indexOf('function scheduleDrop'))
    const block = sched.slice(0, sched.indexOf('\n      }'))

    expect(block).toContain('if (!document.hidden) drop()')
    expect(block).toContain('scheduleDrop()')
  })

  it('takes everything down on unmount', () => {
    const cleanup = code.slice(code.indexOf('return () => {\n      disposed = true'))

    expect(cleanup).toContain('cancelAnimationFrame')
    expect(cleanup).toContain('clearTimeout(live.spawnTimer)')
    expect(cleanup).toContain('for (const timer of live.cascade) clearTimeout(timer)')
    expect(cleanup).toContain('live.teardown()')

    const teardown = code.slice(code.indexOf('live.teardown = () => {'))
    expect(teardown).toContain("removeEventListener('visibilitychange'")
    expect(teardown).toContain("removeEventListener('resize'")
    expect(teardown).toContain('Composite.clear')
    expect(teardown).toContain('Engine.clear')
    expect(teardown).toContain('bodies.clear()')
  })
})

describe('the vellum', () => {
  it('sits above the props and below the page', () => {
    const root = css.slice(css.indexOf('.landing-root {'))
    const block = root.slice(0, root.indexOf('\n}'))

    expect(block).toContain('--landing-z-props: 0')
    expect(block).toContain('--landing-z-vellum: 1')
    expect(block).toContain('--landing-z-content: 2')
    // A stacking context, so none of this can reach the application.
    expect(block).toContain('isolation: isolate')

    expect(rule(atmosphere, '.landing-root .landing-vellum {\n  z-index'))
      .toContain('z-index: var(--landing-z-vellum)')
  })

  it('is milky white with a grain, and the grain never moves', () => {
    const block = rule(atmosphere, '.landing-root .landing-vellum {\n  z-index')

    expect(block).toContain('background-color: color-mix(in oklab, var(--landing-panel)')
    expect(block).toContain('repeating-linear-gradient')
    expect(block).not.toContain('animation')
    expect(block).not.toContain('@keyframes')
  })

  it('costs no filter, blur, or backdrop', () => {
    for (const expensive of ['backdrop-filter', 'filter:', 'blur(']) {
      expect(atmosphere, expensive).not.toContain(expensive)
    }
  })

  it('gives every section a named level rather than a bare surface', () => {
    const root = css.slice(css.indexOf('.landing-root {'))
    const block = root.slice(0, root.indexOf('\n}'))
    for (const level of ['--landing-veil-open', '--landing-veil-mid', '--landing-veil-muted']) {
      expect(block, level).toContain(level)
    }

    const landing = path.join(src, 'features/landing')
    const sections = ['NarrativeSection', 'HowItWorksSection', 'BuildJourneySection',
      'ProductionMarquee', 'LandingFooter', 'HeroSection']
    for (const name of sections) {
      expect(readFileSync(path.join(landing, `${name}.tsx`), 'utf8'), name)
        .toContain('--landing-veil-')
    }

    // Two sections carry a gradient rather than a flat tint, so their level
    // lives in the stylesheet with the rest of the gradient. Neither is bare.
    expect(css).toContain('color-mix(in oklab, var(--landing-cream) var(--landing-veil-muted)')
    const close = rule(css, '.landing-root .landing-close {')
    expect(close).toContain('var(--landing-band)')
    expect(close).toContain('var(--landing-veil-open)')
  })
})

describe('reduced motion never starts the simulation', () => {
  it('answers the question in CSS', () => {
    expect(css).toContain('--landing-physics-motion: 1')
    expect(reduced).toContain('--landing-physics-motion: 0')
    expect(component).not.toContain('matchMedia')
  })

  it('reads that answer before importing anything', () => {
    const branch = code.indexOf('physicsMotionEnabled(layer)')
    const load = code.indexOf("await import('matter-js')")
    expect(branch).toBeGreaterThan(-1)
    expect(branch).toBeLessThan(load)
  })

  it('renders a settled arrangement instead', () => {
    expect(STATIC_PROP_COUNT).toBeGreaterThanOrEqual(4)
    expect(STATIC_PROP_COUNT).toBeLessThanOrEqual(6)
    expect(code).toContain("layer.dataset.settled = 'true'")

    // Placed by the stylesheet, and deliberately uneven — a row of evenly
    // spaced emoji reads as a toolbar.
    const settled = css.slice(css.indexOf(".landing-atmosphere[data-settled='true']"))
    const lefts = [...settled.slice(0, 1400).matchAll(/left:\s*(\d+)%/g)].map((m) => Number(m[1]))
    expect(lefts.length).toBe(STATIC_PROP_COUNT)

    const gaps = lefts.slice(1).map((v, i) => v - lefts[i]!)
    expect(new Set(gaps).size).toBeGreaterThan(1)
  })

  it('promotes nothing that is never going to move', () => {
    expect(rule(atmosphere, ".landing-atmosphere[data-settled='true'] .landing-prop {"))
      .toContain('will-change: auto')
  })
})

describe('E0 stayed in its lane', () => {
  it('introduced no media slot', () => {
    const media = read('features/landing/landing-media.ts')
    expect(media).not.toContain('prop')
    expect(component).not.toContain('landingMedia')
  })

  it('left routing and auth untouched', () => {
    expect(code).not.toMatch(/@\/(routes|lib\/firebase|features\/auth|features\/ai)/)
    expect(existsSync(path.join(src, 'routes/routes.tsx'))).toBe(true)
    expect(read('routes/routes.tsx')).not.toContain('matter')
  })

  it('mounts once, at the top of the landing page', () => {
    const page = read('features/landing/LandingPage.tsx')
    expect((page.match(/<FallingTheaterProps \/>/g) ?? []).length).toBe(1)
    expect(page.indexOf('<FallingTheaterProps />')).toBeLessThan(page.indexOf('<LandingHeader />'))
  })
})
