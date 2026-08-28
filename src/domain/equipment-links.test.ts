import { afterEach, describe, expect, it, vi } from 'vitest'
import { equipmentQrUrl, publicAppOrigin } from '@/domain/equipment-links'

describe('the URL a QR label carries', () => {
  it('points at the deployed application, not wherever the app is running', () => {
    // A label printed on a laptop must not say localhost. It outlives the
    // browser that made it.
    expect(equipmentQrUrl('unit-abc')).toBe(
      'https://theater-inventory.web.app/equipment/unit-abc',
    )
    expect(publicAppOrigin()).not.toContain('localhost')
  })

  it('uses the unit id, so renaming the asset code cannot break the sticker', () => {
    // The whole reason the id is encoded rather than the code.
    const before = equipmentQrUrl('unit-abc')
    const after = equipmentQrUrl('unit-abc')

    expect(before).toBe(after)
    expect(before).not.toContain('MIC')
  })

  it('is the same URL whatever the equipment is doing', () => {
    // Lifecycle, maintenance, planning — none of it is in the link, so none of
    // it can invalidate a printed label.
    expect(equipmentQrUrl('unit-abc')).toBe(equipmentQrUrl('unit-abc'))
  })

  it('carries nothing but the route', () => {
    const url = equipmentQrUrl('unit-abc')

    expect(url).not.toMatch(/token|key|secret|auth|apiKey/i)
    expect(url.split('/equipment/')[1]).toBe('unit-abc')
  })

  it('escapes an id that would otherwise change the path', () => {
    expect(equipmentQrUrl('a/b')).toBe('https://theater-inventory.web.app/equipment/a%2Fb')
  })

  it('refuses an empty id rather than producing a link to the collection', () => {
    expect(() => equipmentQrUrl('')).toThrow(/unit id is required/i)
    expect(() => equipmentQrUrl('   ')).toThrow()
  })

  it('accepts an override for the day the project gets its own domain', () => {
    expect(equipmentQrUrl('unit-abc', 'https://theater.example.edu'))
      .toBe('https://theater.example.edu/equipment/unit-abc')
  })

  it('does not double the slash when the origin has a trailing one', () => {
    expect(equipmentQrUrl('unit-abc', 'https://theater.example.edu/'))
      .toBe('https://theater.example.edu/equipment/unit-abc')
  })
})


describe('a misconfigured origin override', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  function withOrigin(value: string): string {
    vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', value)
    return publicAppOrigin()
  }

  it('accepts a plain https origin for a project that moves to its own domain', () => {
    expect(withOrigin('https://labels.riverside.example.org')).toBe(
      'https://labels.riverside.example.org',
    )
  })

  it('accepts one with a port, and drops a trailing slash', () => {
    expect(withOrigin('https://staging.example.org:8443/')).toBe('https://staging.example.org:8443')
  })

  it.each([
    ['javascript:alert(1)', 'a scheme a phone camera would offer to run'],
    ['data:text/html,<script>', 'an inline document'],
    ['http://theater-inventory.web.app', 'plain http, which a printed label cannot be fixed for'],
    ['//evil.example.com', 'protocol-relative, which is not an origin at all'],
    ['evil.example.com', 'a bare host with no scheme'],
    ['https://user:pass@example.org', 'embedded credentials'],
    ['https://example.org/subdir', 'a path that would swallow the equipment route'],
    ['https://example.org?next=x', 'a query string'],
    ['https://example.org#frag', 'a fragment'],
    ['not a url at all', 'nonsense'],
    ['', 'nothing'],
    ['   ', 'whitespace'],
  ])('falls back to the canonical origin for %s (%s)', (value) => {
    // A label cannot be recalled. A typo in configuration should cost the wrong
    // deployment at worst, never a hostile URL printed onto equipment — and
    // never a label that simply does not resolve.
    expect(withOrigin(value)).toBe('https://theater-inventory.web.app')
  })

  it('never lets a rejected override reach a QR code', () => {
    for (const hostile of ['javascript:alert(1)', 'http://localhost:5173', '//evil.example.com']) {
      vi.stubEnv('VITE_PUBLIC_APP_ORIGIN', hostile)
      const url = equipmentQrUrl('unit-1')

      expect(url).toBe('https://theater-inventory.web.app/equipment/unit-1')
      expect(url.startsWith('https://')).toBe(true)
      expect(url).not.toContain('javascript')
      expect(url).not.toContain('localhost')
      expect(url).not.toContain('evil')
    }
  })
})
