import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTACT_LIMITS, contactReducer, initialContactState, validateContactDraft, type ContactDraft,
} from '@/features/landing/contact-message'
import { MAX_FIELD_PHOTOS, fieldLayoutFor, fieldMediaFrom } from '@/features/landing/field-media'
import { DEMO_ORGANIZATION_NAME, PREVIOUS_DEMO_ORGANIZATION_NAMES } from '@/domain/demo-dataset'

/**
 * The final round: a signed narrative, a section for the field that works with
 * or without its photographs, and a contact form that never claims a delivery
 * it did not make.
 */

const root = path.resolve(import.meta.dirname, '../..')
const src = path.join(root, 'src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

describe('01 / Why I built this', () => {
  const narrative = read('features/landing/NarrativeSection.tsx')

  it('is signed by the person who built it', () => {
    // The rendered copy, not the doc comment that explains why it is signed.
    expect(code('features/landing/NarrativeSection.tsx')).toContain('Patrick Kim')
    expect(narrative).toContain('01 / Why I built this')
  })

  it('carries one large photograph and none of the backstage strip', () => {
    expect(narrative).toContain('landingMedia.story')
    expect(narrative).not.toContain('storyPhotos')
    expect(narrative).toMatch(/lg:col-span-7/)
  })

  it('puts the concept graphic after the story and its photograph', () => {
    const story = narrative.indexOf('landingMedia.story')
    const graphic = narrative.indexOf('One workspace')
    expect(story).toBeGreaterThan(-1)
    expect(graphic).toBeGreaterThan(story)
    for (const label of ['Equipment', 'Production requirements', 'Teams', 'Responsibilities', 'Changes']) {
      expect(narrative, label).toContain(`'${label}'`)
    }
  })
})

describe('05 / In the field — photographs found, not listed', () => {
  const url = (n: string) => `/assets/${n}-hash.webp`

  it('renders nothing when there are no photographs', () => {
    expect(fieldMediaFrom({})).toEqual({ photos: [], logo: null })
    expect(fieldLayoutFor(0)).toBe('none')
  })

  it('takes whichever of the five reserved names exist, in number order', () => {
    const media = fieldMediaFrom({
      './media/field-04.webp': url('field-04'),
      './media/field-01.webp': url('field-01'),
    })
    expect(media.photos.map((p) => p.number)).toEqual([1, 4])
    expect(fieldLayoutFor(media.photos.length)).toBe('pair')
  })

  it('gives each count its own composition, and never more than five', () => {
    expect([1, 2, 3, 4, 5].map(fieldLayoutFor)).toEqual(['single', 'pair', 'trio', 'quad', 'five'])
    expect(fieldLayoutFor(9)).toBe('five')
    expect(MAX_FIELD_PHOTOS).toBe(5)
  })

  it('ignores anything outside the reserved names, and finds the logo', () => {
    const media = fieldMediaFrom({
      './media/field-06.webp': url('field-06'),
      './media/field-1.webp': url('field-1'),
      './media/other.webp': url('other'),
      './media/field-logo.webp': url('field-logo'),
      './media/field-03.webp': url('field-03'),
    })
    expect(media.photos.map((p) => p.number)).toEqual([3])
    expect(media.logo).toBe(url('field-logo'))
  })

  it('discovers files at build time, so an absent file cannot fail the build', () => {
    const module = code('features/landing/field-media.ts')
    expect(module).toContain("import.meta.glob<string>('./media/field-0[1-5].webp'")
    expect(module).toContain("import.meta.glob<string>('./media/field-logo.webp'")
    expect(module).not.toMatch(/^import .*field-0\d\.webp/m)
  })

  it('draws no frame for a photograph that does not exist', () => {
    const section = read('features/landing/FieldSection.tsx')
    expect(section).toContain('photos.length > 0 ?')
    expect(section).toContain('{logo ? (')
    expect(read('features/landing/field-media.ts')).toContain('field-01.webp … field-05.webp')
  })

  it('sits directly after the build journey', () => {
    const page = read('features/landing/LandingPage.tsx')
    expect(page).toMatch(/<BuildJourneySection \/>\s*<FieldSection \/>/)
    expect(read('features/landing/FieldSection.tsx')).toContain('05 / In the field')
  })
})

describe('Contact — validation', () => {
  const draft = (over: Partial<ContactDraft> = {}): ContactDraft =>
    ({ name: 'Ada', title: 'A question', message: 'Hello there.', website: '', ...over })

  it('accepts a complete message, trimmed', () => {
    expect(validateContactDraft(draft({ name: '  Ada  ' }))).toEqual({
      ok: true, value: { name: 'Ada', title: 'A question', message: 'Hello there.' },
    })
  })

  it('requires every field, and treats whitespace as empty', () => {
    const result = validateContactDraft(draft({ name: ' ', title: '', message: '\n' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['message', 'name', 'title'])
  })

  it('bounds every field', () => {
    const result = validateContactDraft(draft({ message: 'x'.repeat(CONTACT_LIMITS.message + 1) }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.message).toMatch(/characters or fewer/)
  })

  it('refuses a filled honeypot without reporting a field error', () => {
    const result = validateContactDraft(draft({ website: 'http://spam.example' }))
    expect(result).toEqual({ ok: false, errors: {}, spam: true })
  })
})

// Delivery through FormSubmit is covered in `landing-contact.test.ts`.
describe('Contact — source', () => {
  it('never writes a message to the console', () => {
    for (const file of ['features/landing/contact-message.ts', 'features/landing/ContactSection.tsx']) {
      expect(code(file), file).not.toMatch(/console\./)
    }
  })

  it('carries no recipient address, and no mailto', () => {
    for (const file of ['features/landing/contact-message.ts', 'features/landing/ContactSection.tsx']) {
      expect(read(file), file).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
      expect(code(file), file).not.toContain('mailto:')
    }
  })
})

describe('Contact — states', () => {
  it('does not move out of unavailable, whatever happens', () => {
    const state = initialContactState(false)
    expect(contactReducer(state, { type: 'submit' })).toBe(state)
    expect(contactReducer(state, { type: 'delivered' })).toBe(state)
  })

  it('ignores a second submit while one is in flight', () => {
    const submitting = contactReducer(initialContactState(true), { type: 'submit' })
    expect(submitting.status).toBe('submitting')
    expect(contactReducer(submitting, { type: 'submit' })).toBe(submitting)
  })

  it('reaches sent only through a delivery, and failed only through a refusal', () => {
    const idle = initialContactState(true)
    expect(contactReducer(idle, { type: 'delivered' })).toBe(idle)

    const submitting = contactReducer(idle, { type: 'submit' })
    expect(contactReducer(submitting, { type: 'delivered' }).status).toBe('sent')
    expect(contactReducer(submitting, { type: 'rejected', reason: 'delivery' })).toMatchObject({
      status: 'failed', failure: 'delivery',
    })
    expect(contactReducer(idle, { type: 'rejected', reason: 'delivery' })).toBe(idle)
  })

  it('clears a field error as that field is edited', () => {
    const invalid = contactReducer(initialContactState(true), {
      type: 'invalid', errors: { name: 'Name is required.', title: 'Title is required.' },
    })
    expect(contactReducer(invalid, { type: 'edit', field: 'name' }).errors).toEqual({ title: 'Title is required.' })
  })

  it('sits at the foot of the page, before the footer', () => {
    const page = read('features/landing/LandingPage.tsx')
    expect(page).toMatch(/<ProductionMarquee \/>\s*<ContactSection \/>\s*<\/main>/)
    expect(page.indexOf('<ContactSection />')).toBeLessThan(page.indexOf('<LandingFooter />'))
  })
})

describe('demo organization', () => {
  it("is Governor's Academy", () => {
    expect(DEMO_ORGANIZATION_NAME).toBe("Governor's Academy")
  })

  it('still recognises an organization seeded under the old name', () => {
    // Without this a re-run of the seed would miss the existing demo and
    // write a complete second copy beside it.
    expect(PREVIOUS_DEMO_ORGANIZATION_NAMES).toContain('Ridgeview High School Theater')
    const seed = readFileSync(path.join(root, 'scripts/seed-demo.ts'), 'utf8')
    expect(seed).toContain('PREVIOUS_DEMO_ORGANIZATION_NAMES.includes(organization.name)')
  })
})
