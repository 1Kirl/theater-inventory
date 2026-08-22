import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC_EMAIL_DOMAIN,
  normalizeUserId,
  toSyntheticEmail,
  validateUserId,
} from '@/domain/user-id'

describe('normalizeUserId', () => {
  it('lowercases the identifier', () => {
    expect(normalizeUserId('Lighting01')).toBe('lighting01')
    expect(normalizeUserId('STAGE_MANAGER')).toBe('stage_manager')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUserId('  lighting01  ')).toBe('lighting01')
    expect(normalizeUserId('\tlighting01\n')).toBe('lighting01')
  })

  it('leaves an already normalized identifier unchanged', () => {
    expect(normalizeUserId('lighting01')).toBe('lighting01')
  })

  it('collapses case and whitespace variants onto the same identifier', () => {
    expect(normalizeUserId(' Lighting01 ')).toBe(normalizeUserId('lighting01'))
  })
})

describe('validateUserId', () => {
  it('accepts identifiers using every allowed character class', () => {
    for (const id of ['abc', 'lighting01', 'stage.manager', 'stage_manager', 'stage-manager', '0abc', 'a'.repeat(20)]) {
      expect(validateUserId(id).valid, id).toBe(true)
    }
  })

  it('rejects an empty identifier', () => {
    expect(validateUserId('').valid).toBe(false)
  })

  it('rejects identifiers shorter than 3 characters', () => {
    expect(validateUserId('ab').valid).toBe(false)
  })

  it('rejects identifiers longer than 20 characters', () => {
    expect(validateUserId('a'.repeat(21)).valid).toBe(false)
  })

  it('rejects disallowed characters', () => {
    for (const id of ['light ing', 'light@ing', 'light+ing', 'lighting!', 'light/ing', 'lightíng']) {
      expect(validateUserId(id).valid, id).toBe(false)
    }
  })

  it('rejects uppercase, since validation runs on normalized input', () => {
    expect(validateUserId('Lighting01').valid).toBe(false)
  })

  it('rejects identifiers not starting with a letter or number', () => {
    for (const id of ['.lighting', '_lighting', '-lighting']) {
      expect(validateUserId(id).valid, id).toBe(false)
    }
  })

  it('returns a message explaining the failure', () => {
    const result = validateUserId('ab')
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.message.length).toBeGreaterThan(0)
    }
  })
})

describe('toSyntheticEmail', () => {
  it('appends the reserved internal domain', () => {
    expect(toSyntheticEmail('lighting01')).toBe(`lighting01@${SYNTHETIC_EMAIL_DOMAIN}`)
  })

  it('uses the documented example mapping', () => {
    expect(toSyntheticEmail('lighting01')).toBe('lighting01@theater-inventory.example.com')
  })

  it('preserves allowed punctuation in the local part', () => {
    expect(toSyntheticEmail('stage.manager-01_a')).toBe(
      `stage.manager-01_a@${SYNTHETIC_EMAIL_DOMAIN}`,
    )
  })

  it('throws rather than producing a credential from an invalid User ID', () => {
    expect(() => toSyntheticEmail('ab')).toThrow()
    expect(() => toSyntheticEmail('Lighting01')).toThrow()
    expect(() => toSyntheticEmail('.lighting')).toThrow()
  })

  it('maps normalization variants onto the same credential', () => {
    const fromRaw = toSyntheticEmail(normalizeUserId('  Lighting01 '))
    expect(fromRaw).toBe(toSyntheticEmail('lighting01'))
  })
})
