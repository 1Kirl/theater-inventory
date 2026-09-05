import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One product story, told once.
 *
 * The page used to tell it twice: a section claiming "one workspace" over a
 * dashboard screenshot, and then four full-width rows presenting four separate
 * product screens. The second undid the first. This section replaces both, so
 * the guarantees worth holding are that the duplication is actually gone, that
 * none of the copy went with it, and that a phone still gets a document rather
 * than a scroll-driven effect it cannot run.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const showcase = read('features/landing/ProductShowcase.tsx')
const page = read('features/landing/LandingPage.tsx')
const media = read('features/landing/landing-media.ts')
const css = read('features/landing/landing.css')

/** Just the showcase's own rules, so a neighbouring section cannot answer for it. */
const section = css.slice(
  css.indexOf('product showcase */'),
  css.indexOf('photo strip */'),
)
const mobile = section.slice(0, section.indexOf('@media (min-width: 1024px)'))
const desktop = section.slice(section.indexOf('@media (min-width: 1024px)'))
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

describe('the two product sections became one', () => {
  it('renders a single showcase rather than a workspace and a feature list', () => {
    expect(page).toContain('<ProductShowcase />')
    expect(page).not.toContain('WorkspaceSection')
    expect(page).not.toContain('FeatureShowcase')
  })

  it('leaves no dead component behind', () => {
    // A superseded section left in the tree is one somebody re-imports later.
    for (const gone of ['WorkspaceSection.tsx', 'FeatureShowcase.tsx']) {
      expect(existsSync(path.join(src, 'features/landing', gone)), gone).toBe(false)
    }
  })

  it('keeps the navigation target the header already links to', () => {
    expect(showcase).toContain('id="features"')
    expect(read('features/landing/LandingHeader.tsx')).toContain("href: '#features'")
  })

  it('carries the claims the old summary grid made', () => {
    // "What needs attention" and "who is responsible" had no home among the
    // four modules, so they were folded into the overview rather than dropped.
    expect(showcase).toContain('Shortages, overdue repairs, and upcoming dates')
    expect(showcase).toContain('the team and the person responsible')
  })

  it('keeps every feature the old showcase explained', () => {
    for (const headline of [
      'Know what you actually have.',
      'Repairs stop being invisible.',
      'Plan a show against what is really on the shelf.',
      'Ask the inventory a question.',
    ]) {
      expect(showcase, headline).toContain(headline)
    }
  })
})

describe('the media contract is unchanged', () => {
  it('uses the five slots that already exist and no others', () => {
    expect(showcase).toContain('landingMedia.workspace')
    expect(showcase).toContain('landingMedia.features[stage.key]')

    for (const key of ['inventory', 'maintenance', 'productions', 'ai']) {
      expect(showcase, key).toContain(`'${key}'`)
    }
  })

  it('adds no new slot to the media file', () => {
    // Final screenshots arrive later; the replacement must be a src edit, not
    // another layout.
    const feature = media.slice(media.indexOf('features: {'))
    const keys = [...feature.slice(0, feature.indexOf('\n  }')).matchAll(/^\s{4}(\w+):/gm)]
    expect(keys.map((m) => m[1])).toEqual(['inventory', 'maintenance', 'productions', 'ai'])
  })

  it('renders exactly one media frame per stage', () => {
    expect((showcase.match(/<MediaPlaceholder/g) ?? []).length).toBe(1)
    expect((showcase.match(/index: '0\d'/g) ?? []).length).toBe(5)
  })
})

describe('one measurement drives the whole sequence', () => {
  it('takes a single scroll-progress source', () => {
    expect((showcase.match(/useScrollProgress\(\)/g) ?? []).length).toBe(1)
    expect(showcase).toContain('ref={trackRef}')
  })

  it('adds no listener of its own', () => {
    expect(showcase).not.toContain('addEventListener')
    expect(showcase).not.toContain('requestAnimationFrame')
    expect(showcase).not.toContain('setInterval')
  })

  it('never re-renders on scroll', () => {
    // Everything downstream is a CSS custom property; React sees one ref.
    expect(showcase).not.toContain('useState')
    expect(showcase).not.toContain('useEffect')
  })

  it('derives each stage from the shared cursor rather than its own value', () => {
    expect(desktop).toContain('--sequence:')
    expect(desktop).toContain('--cursor:')
    // The triangle: fully present at its own stage, gone one stage away.
    expect(desktop).toMatch(/--active:\s*clamp\(0,\s*calc\(1 - var\(--distance\)\),\s*1\)/)
  })
})

describe('the desktop stage is CSS, not JavaScript pinning', () => {
  it('sticks rather than fixes', () => {
    const stage = desktop.slice(desktop.indexOf('.showcase-stage {'))
    const block = stage.slice(0, stage.indexOf('}'))

    expect(block).toContain('position: sticky')
    expect(block).not.toContain('position: fixed')
  })

  it('clears the sticky header and leaves the page visible behind it', () => {
    const stage = desktop.slice(desktop.indexOf('.showcase-stage {'))
    const block = stage.slice(0, stage.indexOf('}'))

    expect(block).toMatch(/top:\s*5rem/)
    // Under a full viewport, so the next section is never entirely hidden.
    expect(block).toMatch(/height:\s*(\d+)vh/)
    expect(Number(block.match(/height:\s*(\d+)vh/)?.[1])).toBeLessThan(100)
  })

  it('never touches native scrolling', () => {
    for (const banned of ['overflow: hidden', 'scroll-snap', 'overscroll-behavior']) {
      expect(desktop, banned).not.toContain(banned)
    }
    expect(showcase).not.toContain('preventDefault')
  })

  it('moves transform and opacity only', () => {
    for (const selector of ['.showcase-item {', '.showcase-item__copy {', '.showcase-item__media {']) {
      const at = desktop.slice(desktop.indexOf(selector))
      const block = at.slice(0, at.indexOf('\n  }'))
      // Layout properties would make every frame a reflow.
      expect(block, selector).not.toMatch(/\b(width|height|top|left):\s*(?!auto)/)
    }
  })

  it('keeps an inactive screen visible enough to say the product has parts', () => {
    const media = desktop.slice(desktop.indexOf('.showcase-item__media {'))
    const floor = Number(media.match(/opacity:\s*calc\(([\d.]+) \+/)?.[1])

    expect(floor).toBeGreaterThan(0.1)
    expect(floor).toBeLessThan(0.4)
  })

  it('never shows two paragraphs at once', () => {
    // A screen that is not being read reads as depth, because it is offset and
    // scaled. Text has none of that: two paragraphs crossfading in one column
    // is a smear, and a headline arriving between the lines of the one leaving
    // is worse. Keying the copy to `--active > 0.5` makes the overlap
    // impossible rather than merely faint, since only one stage can be nearest.
    const copy = desktop.slice(desktop.indexOf('.showcase-item__copy {'))
    const block = copy.slice(0, copy.indexOf('\n  }'))
    const threshold = block.match(/opacity:\s*clamp\(0,\s*calc\(\(var\(--active\) - ([\d.]+)\)/)?.[1]

    expect(Number(threshold)).toBeGreaterThanOrEqual(0.5)
  })

  it('separates the paragraph leaving from the one arriving', () => {
    // Signed on the cursor, so they pass in opposite directions rather than
    // dissolving through each other in place.
    const copy = desktop.slice(desktop.indexOf('.showcase-item__copy {'))
    expect(copy.slice(0, copy.indexOf('\n  }')))
      .toMatch(/translate3d\(0, calc\(\(var\(--stage\) - var\(--cursor\)\) \* \d+px\), 0\)/)
  })

  it('reserves the rail its own strip, so a long paragraph cannot run into it', () => {
    expect(desktop).toContain('--rail-strip:')

    const item = desktop.slice(desktop.indexOf('.showcase-item {'))
    expect(item.slice(0, item.indexOf('\n  }'))).toContain('padding-block: 0 var(--rail-strip)')
  })

  it('stays inside the movement budget the phase set', () => {
    const restX = Number(desktop.match(/--rest-x:\s*calc\(\(var\(--stage\) - 2\) \* (\d+)px\)/)?.[1])
    // Two stages from centre is the furthest any screen rests.
    expect(restX * 2).toBeLessThanOrEqual(140)

    const rotation = Number(desktop.match(/\* ([\d.]+)deg \* \(1 - var\(--active\)\)/)?.[1])
    expect(rotation * 2).toBeLessThanOrEqual(2)
  })
})

describe('a phone gets a document', () => {
  it('puts the sticky stage behind a width query', () => {
    // Everything outside the desktop block must be plain flow.
    expect(mobile).not.toContain('position: sticky')
    expect(mobile).not.toContain('position: absolute')
  })

  it('keeps copy and its screen together in one item', () => {
    // The mobile order is the DOM order: read a paragraph, see the screen it
    // describes. There is no second markup path to keep in step.
    const item = showcase.indexOf('showcase-item__copy')
    const figure = showcase.indexOf('showcase-item__media')
    expect(item).toBeLessThan(figure)
  })

  it('hides the desktop rail where the document order already says the order', () => {
    const rail = mobile.slice(mobile.indexOf('.landing-root .showcase-rail {'))
    expect(rail.slice(0, rail.indexOf('}'))).toContain('display: none')
  })
})

describe('reduced motion returns it to a readable document', () => {
  it('abandons the sticky stage rather than freezing it', () => {
    // A stuck panel whose contents no longer change is a reader scrolling past
    // nothing, which is worse than no effect at all.
    expect(reduced).toContain('.showcase-stage')
    expect(reduced).toMatch(/\.showcase-stage \{[^}]*position:\s*static/s)
    expect(reduced).toMatch(/\.showcase-track \{[^}]*height:\s*auto/s)
  })

  it('makes every stage fully visible in normal flow', () => {
    const item = reduced.slice(reduced.indexOf('.landing-root .showcase-item {'))
    const block = item.slice(0, item.indexOf('}'))

    expect(block).toContain('position: static')
    expect(block).toContain('opacity: 1')
  })

  it('stops every progress-driven transform and fade', () => {
    // Not only the offsets. `--scroll-progress` never moves here, so anything
    // still keyed to it is stuck at its starting value — which for the copy and
    // the screens means four of the five stages invisible.
    const at = reduced.slice(reduced.indexOf('.landing-root .showcase-item__copy,'))
    const block = at.slice(0, at.indexOf('\n  }'))

    expect(block).toContain('.showcase-item__media')
    expect(block).toContain('transform: none')
    expect(block).toContain('opacity: 1')
  })
})

describe('Phase C stayed in its lane', () => {
  it('left the hero untouched', () => {
    const hero = read('features/landing/HeroSection.tsx')
    expect(hero).toContain('usePointerDepth')
    expect(hero).not.toContain('showcase')
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
