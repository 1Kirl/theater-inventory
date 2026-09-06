import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One workflow, drawn as one line.
 *
 * The section this replaces was four rows of identical geometry, each a
 * viewport tall, with nothing between them to say they were steps of anything.
 * What is worth holding is that the four steps survived, that the thing
 * connecting them is a single measurement rather than four, and that a phone
 * and a reader who has turned motion off both still get the whole diagram.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const section = read('features/landing/HowItWorksSection.tsx')
/** Code only. Several assertions below are about words this file must not use,
 *  and the comments explaining why are full of exactly those words. */
const code = section.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const media = read('features/landing/landing-media.ts')
const css = read('features/landing/landing.css')

/** Just this section's rules, so a neighbouring section cannot answer for it. */
const block = css.slice(css.indexOf('how it works */'), css.indexOf('photo strip */'))
const mobile = block.slice(0, block.indexOf('@media (min-width: 1024px)'))
const desktop = block.slice(block.indexOf('@media (min-width: 1024px)'))
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

/** The rules for one selector, without the neighbours that follow it. */
function rule(source: string, selector: string): string {
  const at = source.indexOf(selector)
  expect(at, selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('\n}', at) + 2)
}

describe('the four steps survived the compression', () => {
  it('still walks the whole workflow, setup to production', () => {
    for (const title of [
      'Create or join an organization',
      'Get teams and permissions',
      'Record what the program owns',
      'Plan a production against it',
    ]) {
      expect(section, title).toContain(title)
    }
    expect((section.match(/number: '0\d'/g) ?? []).length).toBe(4)
  })

  it('keeps the reason the assignment step exists', () => {
    // Joining with a code grants nothing until an Admin assigns teams and
    // permissions. Dropping that would describe a product that opens further
    // on joining than this one does.
    expect(section).toContain('Joining grants nothing by itself')
  })

  it('describes the actions rather than re-explaining the modules', () => {
    // The Product Showcase directly above owns the mechanisms. Repeating them
    // here is what made this read as a second feature list.
    for (const owned of ['individually tracked', 'QR label', 'live availability', 'shortage']) {
      expect(code.toLowerCase(), owned).not.toContain(owned.toLowerCase())
    }
  })
})

describe('the media contract is unchanged', () => {
  it('uses the slots that already exist', () => {
    expect(section).toContain('landingMedia.howItWorks[index]')
  })

  it('adds no new slot', () => {
    const list = media.slice(media.indexOf('howItWorks: ['), media.indexOf('productionPhotos: ['))
    const ids = [...list.matchAll(/id: '([\w-]+)'/g)].map((m) => m[1])

    expect(ids).toEqual(['step-organization', 'step-assignment', 'step-records', 'step-production'])
  })

  it('renders one frame per step and no more', () => {
    expect((section.match(/<MediaPlaceholder/g) ?? []).length).toBe(1)
  })
})

describe('one measurement drives the whole section', () => {
  it('takes a single scroll-progress source', () => {
    expect((section.match(/useScrollProgress\(\)/g) ?? []).length).toBe(1)
    expect(section).toContain('ref={trackRef}')
  })

  it('adds no listener and no timer of its own', () => {
    for (const banned of ['addEventListener', 'requestAnimationFrame', 'setInterval', 'setTimeout']) {
      expect(code, banned).not.toContain(banned)
    }
  })

  it('never re-renders on scroll', () => {
    // Everything downstream is a CSS custom property. The only React state in
    // the file is the reveal group's one-shot observer.
    expect(code).not.toContain('useState')
    expect(code).not.toContain('useEffect')
  })

  it('derives the reading head from that one source', () => {
    const track = rule(mobile, '.landing-root .workflow-track {')

    expect(track).toMatch(/--head:\s*clamp\(0, calc\(\(var\(--scroll-progress\) - [\d.]+\) \/ [\d.]+\), 1\)/)
    // Four steps, so the head runs across three gaps.
    expect(track).toContain('--cursor: calc(var(--head) * 3)')
  })

  it('gives each step its own state off the shared cursor', () => {
    const step = rule(mobile, '.landing-root .workflow-step {')

    for (const derived of ['--reached:', '--drawn:', '--active:']) {
      expect(step, derived).toContain(derived)
      expect(step, derived).toContain('var(--cursor)')
    }
    expect(step).toContain('var(--step)')
  })
})

describe('the line is the progress indicator', () => {
  it('advances by transform rather than by size', () => {
    // A line that animates its height relayouts the row on every frame.
    const fill = rule(mobile, '.landing-root .workflow-marker__fill {')

    expect(fill).toContain('transform: scaleY(var(--drawn))')
    expect(fill).toContain('transform-origin: top')
    expect(fill).not.toMatch(/\b(height|block-size|width|inline-size):/)
  })

  it('fills a node as the head reaches it', () => {
    expect(rule(mobile, '.landing-root .workflow-marker__dot::before {')).toContain('scale(var(--reached))')
  })

  it('stops at the last node, because the process ends there', () => {
    expect(mobile).toContain('.landing-root .workflow-step:last-child .workflow-marker__line')
  })

  it('spans the row through the explicit grid, not the implicit one', () => {
    // `grid-row: 1 / -1` counts lines in the explicit grid. Left implicit, the
    // span collapses to the first row and the connector stops short of the
    // next node wherever the screenshot stacks below the copy.
    expect(rule(mobile, '.landing-root .workflow-step {')).toContain('grid-template-rows:')
    expect(rule(desktop, '.landing-root .workflow-step {')).toContain('grid-template-rows:')
    expect(rule(mobile, '.landing-root .workflow-marker {')).toContain('grid-row: 1 / -1')
  })

  it('reaches the next node by geometry rather than by a guessed distance', () => {
    const line = rule(mobile, '.landing-root .workflow-marker__line {')
    expect(line).toContain('margin-block-end: calc(-1 * (2 * var(--workflow-pad) + var(--workflow-node)))')
  })
})

describe('emphasis never costs contrast', () => {
  it('leaves every paragraph at full strength', () => {
    // Dimming copy a reader has not reached yet buys drama at the cost of
    // legibility on text that is on screen.
    expect(rule(mobile, '.landing-root .workflow-step__copy {')).not.toContain('opacity')
  })

  it('carries the active state on the label and the screenshot instead', () => {
    expect(rule(mobile, '.landing-root .workflow-step__number {')).toContain('var(--reached)')

    const frame = rule(mobile, '.landing-root .workflow-step__frame {')
    expect(frame).toContain('var(--active)')
    expect(frame).toMatch(/opacity:\s*calc\(0\.8\d \+/)
  })

  it('keeps the standing emphasis off the element the entrance owns', () => {
    // `[data-revealed='true'] [data-reveal]` outranks a class rule, so an
    // emphasis written onto the revealed wrapper silently never applies.
    expect(section).toMatch(/data-reveal[\s\S]{0,80}workflow-step__media/)
    expect(section).toMatch(/workflow-step__frame/)
    expect(rule(mobile, '.landing-root .workflow-step__media {')).not.toContain('opacity')
  })
})

describe('a phone gets the same diagram, in one column', () => {
  it('pins nothing, anywhere', () => {
    // The section above is a sticky stage. Repeating that here would make the
    // two read as one long effect, and would trap a phone in it.
    expect(block).not.toContain('position: sticky')
    expect(block).not.toContain('position: fixed')
    expect(code).not.toContain('sticky')
  })

  it('stacks the screenshot under its copy below the desktop breakpoint', () => {
    const media = rule(mobile, '.landing-root .workflow-step__media {')
    expect(media).toContain('grid-row: 2')

    expect(rule(desktop, '.landing-root .workflow-step__media {')).toContain('grid-row: 1')
  })

  it('leaves native scrolling alone', () => {
    for (const banned of ['overflow: hidden', 'scroll-snap', 'overscroll-behavior', 'scroll-behavior']) {
      expect(block, banned).not.toContain(banned)
    }
    expect(code).not.toContain('preventDefault')
  })

  it('introduces nothing that can push the page sideways', () => {
    // The one negative margin is the connector's vertical overrun into the
    // next row. A negative inline margin, or a viewport width, is how a
    // section starts scrolling the whole document horizontally.
    expect(block).not.toContain('vw')
    expect(block).not.toContain('margin-inline-end: calc(-1')
    expect(block).not.toContain('margin-inline-start: calc(-1')
    expect((block.match(/margin-block-end: calc\(-1/g) ?? []).length).toBe(1)
  })
})

describe('reduced motion shows the finished diagram', () => {
  it('draws the line, fills every node, and un-dims every screenshot', () => {
    // All four are otherwise functions of `--scroll-progress`, which never
    // moves here — so without these the line stays empty, the nodes stay
    // hollow, and three of the four screenshots sit permanently dimmed.
    expect(rule(reduced, '.landing-root .workflow-marker__fill {')).toContain('transform: scaleY(1)')
    expect(reduced).toContain('.landing-root .workflow-marker__dot::before')
    expect(rule(reduced, '.landing-root .workflow-step__number {')).toContain('color: var(--primary)')

    const frame = rule(reduced, '.landing-root .workflow-step__frame {')
    expect(frame).toContain('opacity: 1')
    expect(frame).toContain('transform: none')
  })

  it('needs no JavaScript to do any of it', () => {
    expect(code).not.toContain('matchMedia')
    expect(code).not.toContain('prefers-reduced-motion')
  })
})

describe('Phase D stayed in its lane', () => {
  it('left the unified Product Showcase alone', () => {
    const showcase = read('features/landing/ProductShowcase.tsx')
    expect(showcase).toContain('id="features"')
    expect(read('features/landing/landing.css')).toContain('.landing-root .showcase-stage')
    expect(code).not.toContain('showcase')
  })

  it('left the Hero alone', () => {
    const hero = read('features/landing/HeroSection.tsx')
    expect(hero).toContain('usePointerDepth')
    expect(hero).not.toContain('workflow')
  })

  it('did not turn BuildJourney into a second copy of this section', () => {
    // Both express progression, so what keeps them apart has to be structural:
    // this one fills as a reader descends and that one arrives complete with
    // the section, and neither borrows the other's markup.
    const journey = read('features/landing/BuildJourneySection.tsx')

    expect(journey).not.toContain('useScrollProgress')
    expect(journey).not.toContain('workflow-')
    expect(journey).toContain('journey-track')
  })

  it('touched nothing outside the landing page', () => {
    expect(code).not.toMatch(/@\/(routes|lib\/firebase|features\/auth|features\/ai)/)
    expect(read('features/landing/LandingPage.tsx')).toContain('<HowItWorksSection />')
  })

  it('added no animation dependency', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>
    }
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    for (const banned of ['gsap', 'framer-motion', 'motion', 'lenis']) {
      expect(all, banned).not.toContain(banned)
    }
  })
})
