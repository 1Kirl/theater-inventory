import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { landingMedia, type LandingMedia } from '@/features/landing/landing-media'

/**
 * The media contract, while the images are still missing.
 *
 * Nineteen frames are declared and none of them has an image yet, so what these
 * hold is the shape of the handover: every declared frame is actually rendered
 * somewhere, every frame keeps its space open so a late image cannot move the
 * page, exactly one image is worth fetching first, and the film strip stays
 * decorative. They are also what will catch a frame going stale once assets do
 * start arriving one at a time.
 */

const src = path.resolve(import.meta.dirname, '../../src')
const landingDir = path.join(src, 'features/landing')
const read = (file: string) => readFileSync(path.join(landingDir, file), 'utf8')

const every: LandingMedia[] = [
  landingMedia.hero,
  landingMedia.story,
  landingMedia.workspace,
  ...Object.values(landingMedia.features),
  ...landingMedia.howItWorks,
  ...landingMedia.productionPhotos,
]

describe('every declared frame is a real frame', () => {
  it('declares twenty-two, with unique ids', () => {
    expect(every).toHaveLength(22)
    expect(new Set(every.map((m) => m.id)).size).toBe(22)
  })

  it('holds its space open, so a late image moves nothing', () => {
    for (const media of every) {
      expect(media.aspect, media.id).toMatch(/^\d+ \/ \d+$/)
    }
  })

  it('has an asset in every frame', () => {
    // Every frame is filled. A slot deliberately left empty would need saying
    // out loud rather than quietly drawing a placeholder on a finished page.
    for (const media of every) {
      expect(media.src, media.id).toBeDefined()
      expect(media.src, media.id).toMatch(/\.webp/)
    }
  })

  it('gives the narrative one photograph, and not the backstage strip', () => {
    expect(landingMedia.story.src).toMatch(/production-04/)
    // The three backstage frames moved to the film strip.
    expect(landingMedia.story.src).not.toMatch(/story-backstage/)
  })

  it('carries the six added photographs in the film strip, alongside the old ones', () => {
    const strip = landingMedia.productionPhotos.map((m) => m.src ?? '')
    for (const file of ['story-backstage1', 'story-backstage2', 'story-backstage3', 'add01', 'add02', 'add03',
      'production-01', 'production-02', 'production-03', 'production-05']) {
      expect(strip.some((src) => src.includes(file)), file).toBe(true)
    }
  })

  it('shows the narrative photograph in the film strip as well, on purpose', () => {
    const strip = landingMedia.productionPhotos.map((m) => m.src)
    expect(strip).toContain(landingMedia.story.src)
  })

  it('never repeats a photograph within the film strip', () => {
    const strip = landingMedia.productionPhotos.map((m) => m.src)
    expect(new Set(strip).size).toBe(strip.length)
  })

  it('describes the photograph it actually points at', () => {
    // Two of these were transposed once: the alt said auditorium and the file
    // was the scene shop. The narrative's photograph is in the strip too, so
    // it is held to the same description in both places.
    const byFile = new Map<string, Set<string>>()
    for (const media of [landingMedia.story, ...landingMedia.productionPhotos]) {
      const file = media.src ?? ''
      byFile.set(file, (byFile.get(file) ?? new Set()).add(media.alt))
    }
    for (const [file, alts] of byFile) {
      expect(alts.size, `${file} is described ${alts.size} different ways`).toBe(1)
    }
  })

  it('says what belongs in it, rather than that it is empty', () => {
    for (const media of every) {
      expect(media.description.length, media.id).toBeGreaterThan(20)
      // "Replace with..." is a note to nobody once the file is the shot list.
      expect(media.description, media.id).not.toMatch(/^Replace with/)
      expect(media.label.length, media.id).toBeGreaterThan(0)
    }
  })

  it('carries alt text that describes rather than announces', () => {
    for (const media of every) {
      expect(media.alt, media.id).toMatch(/\.$/)
      expect(media.alt.toLowerCase(), media.id).not.toMatch(/^(image|photo|screenshot)( of)?\.?$/)
      expect(media.alt.length, media.id).toBeGreaterThan(15)
    }
  })

  it('is loaded from this project, never from anywhere else', () => {
    for (const media of every) {
      if (media.src === undefined) continue
      expect(media.src, media.id).not.toMatch(/^https?:/)
      expect(media.src, media.id).not.toMatch(/unsplash|pexels|shutterstock|getty/i)
    }
    expect(read('landing-media.ts')).not.toMatch(/https?:\/\//)
  })
})

describe('nothing is declared that nothing renders', () => {
  it('leaves no unused file in the media directory', () => {
    const map = read('landing-media.ts')
    for (const file of readdirSync(path.join(landingDir, 'media'))) {
      expect(map, file).toContain(file)
    }
  })

  it('renders all six groups', () => {
    const sources = readdirSync(landingDir)
      .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
      .map((f) => read(f))
      .join('\n')

    for (const reference of [
      'landingMedia.hero',
      'landingMedia.story',
      'landingMedia.workspace',
      'landingMedia.features[stage.key]',
      'landingMedia.howItWorks[index]',
      'landingMedia.productionPhotos',
    ]) {
      expect(sources, reference).toContain(reference)
    }
  })

  it('keeps a fallback where a frame is looked up by index', () => {
    // `howItWorks` is indexed, and an index that ran past the end would render
    // nothing at all rather than a placeholder.
    expect(read('HowItWorksSection.tsx')).toContain('?? landingMedia.workspace')
  })

  it('does not make the hero and the workspace the same picture', () => {
    // They are the same screen deliberately shot twice — the dashboard whole,
    // and its cards lifted apart. Shot identically they would be one image
    // shown twice, two sections apart.
    expect(landingMedia.hero.src).toBeDefined()
    expect(landingMedia.hero.src).not.toBe(landingMedia.workspace.src)
    expect(landingMedia.hero.description).not.toBe(landingMedia.workspace.description)
  })

  it('does not make the workflow four more pictures of the showcase', () => {
    const showcase = Object.values(landingMedia.features).map((m) => m.description)
    for (const step of landingMedia.howItWorks) {
      expect(showcase, step.id).not.toContain(step.description)
    }
  })
})

describe('what gets fetched, and when', () => {
  it('fetches exactly one image eagerly', () => {
    // Callers only: the frame component itself declares the prop.
    const callers = readdirSync(landingDir)
      .filter((f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'MediaPlaceholder.tsx')
      .map((f) => read(f))
      .join('\n')

    // The hero is the largest thing above the fold; lazy-loading it is how a
    // page ends up waiting on its own first impression.
    expect(callers).toContain('media={landingMedia.hero} variant="browser" priority')
    expect((callers.match(/\bpriority\b/g) ?? []).length).toBe(1)
  })

  it('leaves everything else lazy', () => {
    const frame = read('MediaPlaceholder.tsx')
    expect(frame).toContain("loading={priority ? 'eager' : 'lazy'}")
    expect(frame).toContain("fetchPriority={priority ? 'high' : undefined}")

    // The film strip is always below the fold.
    expect(read('ProductionMarquee.tsx')).toContain('loading="lazy"')
  })

  it('draws the film strip decoratively', () => {
    const marquee = read('ProductionMarquee.tsx')
    expect(marquee).toContain('alt=""')
    // Each photograph appears twice for the seamless loop; sixteen read-aloud
    // descriptions of atmosphere is noise, and the section is labelled.
    expect(marquee).toContain('aria-label="Photographs from productions"')
    expect(marquee).not.toContain('alt={photo.alt}')
  })
})
