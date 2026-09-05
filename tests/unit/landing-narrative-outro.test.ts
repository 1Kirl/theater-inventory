import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The narrative, the project history, and the way out.
 *
 * Two sections used to open with almost the same sentence; one section now
 * carries the idea. Below it the history and the outro have to stay legibly
 * different from the workflow above them and from each other, and all of it has
 * to sit correctly over the atmosphere without any of it going opaque enough to
 * make that atmosphere pointless.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const narrative = read('features/landing/NarrativeSection.tsx')
/** Code only: the comment explaining the merge quotes both old headlines. */
const narrativeCode = narrative.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const journey = read('features/landing/BuildJourneySection.tsx')
const cta = read('features/landing/FinalCtaSection.tsx')
const marquee = read('features/landing/ProductionMarquee.tsx')
const page = read('features/landing/LandingPage.tsx')
const css = read('features/landing/landing.css')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

function rule(source: string, selector: string): string {
  const at = source.indexOf(selector)
  expect(at, selector).toBeGreaterThan(-1)
  return source.slice(at, source.indexOf('\n}', at) + 2)
}

describe('the two narrative sections became one', () => {
  it('renders a single narrative section', () => {
    expect(page).toContain('<NarrativeSection />')
    expect(page).not.toContain('StorySection')
    expect(page).not.toContain('ProblemSection')
  })

  it('leaves no superseded component behind', () => {
    for (const gone of ['StorySection.tsx', 'ProblemSection.tsx']) {
      expect(existsSync(path.join(src, 'features/landing', gone)), gone).toBe(false)
    }
  })

  it('keeps the anchor the header links to', () => {
    expect(narrative).toContain('id="about"')
    expect(read('features/landing/LandingHeader.tsx')).toContain("href: '#about'")
  })

  it('keeps the first person, which is the reason the section exists', () => {
    expect(narrative).toContain('I kept noticing')
    expect(narrative).toContain('became this project')
  })

  it('states the problem once instead of twice', () => {
    // Both sections opened "The backstage work was connected. The ___ wasn't."
    expect((narrativeCode.match(/The backstage work was connected/g) ?? []).length).toBe(1)
    expect(narrativeCode).not.toContain("The information wasn")
  })

  it('keeps every fragment the composition was made of', () => {
    for (const label of ['Equipment', 'Production requirements', 'Teams', 'Responsibilities',
      'Changes', 'One workspace']) {
      expect(narrative, label).toContain(label)
    }
  })

  it('reuses the drift primitive rather than a scroll loop of its own', () => {
    expect(narrative).toContain('landing-drift')
    expect(narrative).not.toContain('useScrollProgress')
    expect(narrative).not.toContain('addEventListener')
  })

  it('adds no media slot, and keeps the one photograph', () => {
    expect(narrative).toContain('landingMedia.story')
    expect((narrative.match(/landingMedia\./g) ?? []).length).toBe(1)
  })

  it('never reaches for the atmosphere behind it', () => {
    // The background is decorative and independent; foreground cards must not
    // pretend to interact with the physics.
    expect(narrative).not.toContain('matter')
    expect(narrative).not.toContain('landing-prop')
  })
})

describe('the project history is a timeline, and not the workflow again', () => {
  it('keeps every factual stage', () => {
    for (const title of ['Problem', 'Information architecture', 'Decisions', 'Development',
      'Testing and iteration']) {
      expect(journey, title).toContain(`title: '${title}'`)
    }
    expect((journey.match(/number: '0\d'/g) ?? []).length).toBe(5)
  })

  it('runs across the page on a desktop and down it on a phone', () => {
    const base = rule(css, '.landing-root .journey-track {')
    expect(base).not.toContain('grid-template-columns')

    const wide = css.slice(css.indexOf('@media (min-width: 768px)', css.indexOf('build journey */')))
    expect(rule(wide, '.landing-root .journey-track {')).toContain('grid-template-columns: repeat(5')
  })

  it('draws the rule with a transform rather than a size', () => {
    const line = rule(css, '.landing-root .journey-line {')
    expect(line).toContain('transform: scaleY(0)')
    expect(line).not.toMatch(/transition:[^;]*\b(width|height)\b/)
  })

  it('is driven by the reveal, not by a second scroll loop', () => {
    // How It Works fills as a reader descends; this arrives complete when the
    // section does. That difference is why they do not read as one component,
    // and it costs no extra continuous measurement.
    expect(journey).not.toContain('useScrollProgress')
    expect(css).toContain(".landing-root [data-revealed='true'] .journey-line")
  })

  it('hijacks no horizontal scrolling', () => {
    const block = css.slice(css.indexOf('build journey */'), css.indexOf('the close */'))
    for (const banned of ['overflow-x', 'scroll-snap', 'position: sticky', 'translateX(-']) {
      expect(block, banned).not.toContain(banned)
    }
  })

  it('is fully drawn when motion is off', () => {
    expect(rule(reduced, '.landing-root .journey-line {')).toContain('transform: scaleX(1) scaleY(1)')
    expect(rule(reduced, '.landing-root .journey-node {')).toContain('transform: scale(1)')
  })
})

describe('the close', () => {
  it('sends people to the same two places as before', () => {
    expect(cta).toContain('paths.signUp')
    expect(cta).toContain('paths.logIn')
    expect((cta.match(/<Link/g) ?? []).length).toBe(2)
  })

  it('carries no product screenshot', () => {
    expect(cta).not.toContain('MediaPlaceholder')
    expect(cta).not.toContain('landingMedia')
  })

  it('is strongest where the words are and thinnest where the props rest', () => {
    // One gradient rather than a flat tint, so the band can be green enough to
    // close the page and open enough at its foot to let the pile through.
    const close = rule(css, '.landing-root .landing-close {')
    const stops = [...close.matchAll(/var\(--landing-band\) (\d+)%/g)].map((m) => Number(m[1]))

    expect(stops.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...stops)).toBeGreaterThan(stops[0]!)
    expect(close).toContain('var(--landing-veil-open)')
  })

  it('gives the buttons the hover primitive the page already has', () => {
    expect((cta.match(/landing-lift/g) ?? []).length).toBe(2)
  })
})

describe('the outro strip', () => {
  it('reuses the photographs it already had', () => {
    expect(marquee).toContain('landingMedia.productionPhotos')
    expect(marquee).not.toContain('productionPhotos2')
    expect(read('features/landing/landing-media.ts')).not.toContain('marqueeBack')
  })

  it('runs two rows in opposite directions at different speeds', () => {
    expect(marquee).toContain("variant=\"front\"")
    expect(marquee).toContain("variant=\"back\"")

    expect(css).toContain('@keyframes landing-marquee-scroll-back')
    const back = css.slice(css.indexOf('.landing-root .landing-marquee__track--back {',
      css.indexOf('@media (min-width: 768px)', css.indexOf('photo strip */'))))
    const block = back.slice(0, back.indexOf('\n  }'))

    expect(block).toContain('animation-name: landing-marquee-scroll-back')
    expect(block).toMatch(/animation-duration: \d+s/)
    // Set back rather than merely repeated.
    expect(block).toMatch(/opacity: 0\.\d+/)
  })

  it('shows one row on a phone', () => {
    expect(rule(css, '.landing-root .landing-marquee__track--back {')).toContain('display: none')
  })

  it('stops autoplaying but stays scrollable when motion is off', () => {
    expect(reduced).toContain('animation: none !important')
    expect(reduced).toContain('overflow-x: auto')
    expect(rule(reduced, '.landing-root .landing-marquee__track--back {')).toContain('display: none')
    // Still reachable from a keyboard.
    expect(marquee).toContain('tabIndex={0}')
  })
})

describe('Phase E respected the layers and stayed in its lane', () => {
  it('invents no z-index of its own', () => {
    const added = css.slice(css.indexOf('build journey */'))
    for (const match of added.matchAll(/z-index:\s*(\d+)/g)) {
      expect(Number(match[1]), match[0]).toBeLessThanOrEqual(2)
    }
  })

  it('leaves the atmosphere untouched', () => {
    const atmosphere = read('features/landing/FallingTheaterProps.tsx')
    expect(atmosphere).toContain("await import('matter-js')")
    for (const file of [narrative, journey, cta, marquee]) {
      expect(file).not.toContain('FallingTheaterProps')
    }
  })

  it('leaves the Hero and the Product Showcase alone', () => {
    expect(read('features/landing/HeroSection.tsx')).toContain('usePointerDepth')
    expect(read('features/landing/ProductShowcase.tsx')).toContain('id="features"')
    expect(css).toContain('.landing-root .showcase-stage')
  })

  it('gave How It Works only the two approved polish items', () => {
    const workflow = read('features/landing/HowItWorksSection.tsx')
    // The progression architecture is untouched.
    expect(workflow).toContain('useScrollProgress')
    expect(workflow).toContain('workflow-marker__line')
    expect(css).toContain('--cursor: calc(var(--head) * 3)')
    // The lead's measure, and the gutter the screenshot column was leaving.
    expect(workflow).toContain('max-w-xl text-balance')
    expect(css).toContain('minmax(0, 34rem)')
  })

  it('leaves routing and auth alone', () => {
    for (const file of [narrative, journey, marquee]) {
      expect(file).not.toMatch(/@\/(routes\/routes|lib\/firebase|features\/auth|features\/ai)/)
    }
    // The close still reaches for paths, which is the whole point of it.
    expect(cta).toContain("from '@/routes/paths'")
  })

  it('adds no animation dependency beyond the engine', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>; devDependencies: Record<string, string>
    }
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(all).toContain('matter-js')
    for (const banned of ['gsap', 'framer-motion', 'motion', 'lenis']) {
      expect(all, banned).not.toContain(banned)
    }
  })

  it('adds no further continuous scroll measurement', () => {
    // Matter already runs one loop. Exactly two sections measure scroll, and
    // they are the two that did before this phase.
    const landing = path.join(src, 'features/landing')
    const users = ['HeroSection', 'ProductShowcase', 'HowItWorksSection', 'NarrativeSection',
      'BuildJourneySection', 'FinalCtaSection', 'ProductionMarquee', 'LandingFooter']
      .filter((n) => readFileSync(path.join(landing, `${n}.tsx`), 'utf8').includes('useScrollProgress'))

    expect(users.sort()).toEqual(['HeroSection', 'HowItWorksSection', 'ProductShowcase'])
  })
})
