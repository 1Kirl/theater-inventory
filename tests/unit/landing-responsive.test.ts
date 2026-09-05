import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { densityFor, NARROW_VIEWPORT } from '@/features/landing/theater-props'

/**
 * What a narrow window must not be able to do.
 *
 * Both of the bugs guarded here were found the same way and only once a real
 * narrow viewport could be rendered: a decorative offset, written in pixels,
 * pushing an element past the edge and scrolling the whole document sideways.
 * Neither was visible at the width the earlier phases were checked at, which is
 * the reason these are pinned rather than left to the eye.
 */

const src = path.resolve(import.meta.dirname, '../../src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')
const css = read('features/landing/landing.css')

describe('decoration cannot scroll the page sideways', () => {
  it('holds the scatter back until there is room for it', () => {
    // Measured: 23px of overflow at 390 wide, and 11px still at 768, because
    // these cards are the full width of their column on a narrow screen.
    const base = css.slice(css.indexOf('.landing-root .drift-a {'), css.indexOf('@media (min-width: 1024px) {\n  .landing-root .drift-a'))
    expect(base).not.toContain('--drift-x')
    expect(base).toContain('--drift-y')

    const wide = css.slice(css.indexOf('@media (min-width: 1024px) {\n  .landing-root .drift-a'))
    expect(wide.slice(0, 400)).toContain('--drift-x')
  })

  it('clips the two sections whose decoration reaches outside them', () => {
    // The showcase rests its inactive screens up to 104px out to one side —
    // absorbed by the stage's max-width on a large display, 81px past the
    // viewport at 1024. The narrative scatters its cards the same way.
    const showcase = css.slice(css.indexOf('.landing-root .showcase {'))
    expect(showcase.slice(0, showcase.indexOf('\n}'))).toContain('overflow-x: clip')
    expect(read('features/landing/NarrativeSection.tsx')).toContain('overflow-x-clip')
  })

  it('clips rather than hides, so the sticky stage keeps sticking', () => {
    // `overflow: hidden` would make the section a scroll container and the
    // stage inside it would resolve against that instead of the document.
    const showcase = css.slice(css.indexOf('.landing-root .showcase {'))
    const block = showcase.slice(0, showcase.indexOf('\n}'))

    expect(block).not.toContain('overflow-x: hidden')
    expect(block).not.toContain('overflow: hidden')
    expect(css).toContain('position: sticky')
  })
})

describe('a phone gets less of everything', () => {
  it('carries fewer and smaller props', () => {
    const phone = densityFor(NARROW_VIEWPORT - 1)
    const desktop = densityFor(NARROW_VIEWPORT + 1)

    expect(phone.initial).toBeLessThan(desktop.initial)
    expect(phone.maximum).toBeLessThan(desktop.maximum)
    expect(phone.maxSize).toBeLessThan(desktop.maxSize)
    expect(phone.minInterval).toBeGreaterThan(desktop.minInterval)
  })

  it('drops the second outro row and the hero drift', () => {
    const back = css.slice(css.indexOf('.landing-root .landing-marquee__track--back {'))
    expect(back.slice(0, back.indexOf('\n}'))).toContain('display: none')

    // Two blobs on a slow cycle are desktop-only decoration. There is a base
    // rule for the blobs as well, so the animation declaration is what has to
    // be looked for rather than the selector.
    const drift = css.indexOf('animation: hero-drift-a')
    expect(drift).toBeGreaterThan(-1)
    expect(css.slice(0, drift).lastIndexOf('@media (min-width: 768px)'))
      .toBeGreaterThan(css.slice(0, drift).lastIndexOf('\n}'))
  })
})

describe('the loop does no work it does not have to', () => {
  it('writes a transform only for a body that moved', () => {
    // A settled pile is the page's resting state and lasts as long as the
    // visit. Thirty-four style writes a frame for bodies that cannot move is
    // the one piece of real waste in the loop.
    const component = read('features/landing/FallingTheaterProps.tsx')
    const loop = component.slice(component.indexOf('for (const [id, body] of bodies) {',
      component.indexOf('const step = (now: number)')))

    expect(loop.slice(0, 200)).toContain('if (body.isSleeping) continue')
  })

  it('subscribes to scroll only while a section is on screen', () => {
    const hook = read('features/landing/use-scroll-progress.ts')
    // The listeners are added by the observer's callback, not at mount.
    expect(hook).toContain('new IntersectionObserver')
    const add = hook.indexOf("addEventListener('scroll'")
    const observer = hook.indexOf('new IntersectionObserver')
    expect(add).toBeGreaterThan(-1)
    expect(observer).toBeGreaterThan(add)
    expect(hook).toContain("removeEventListener('scroll'")
  })

  it('keeps the page to three scroll-measured sections and one pointer', () => {
    const landing = path.join(src, 'features/landing')
    const files = ['HeroSection', 'ProductShowcase', 'HowItWorksSection', 'NarrativeSection',
      'BuildJourneySection', 'FinalCtaSection', 'ProductionMarquee', 'LandingFooter']
    const scroll = files.filter((n) => readFileSync(path.join(landing, `${n}.tsx`), 'utf8').includes('useScrollProgress'))
    const pointer = files.filter((n) => readFileSync(path.join(landing, `${n}.tsx`), 'utf8').includes('usePointerDepth'))

    expect(scroll.sort()).toEqual(['HeroSection', 'HowItWorksSection', 'ProductShowcase'])
    expect(pointer).toEqual(['HeroSection'])
  })
})
