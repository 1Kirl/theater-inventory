import { describe, expect, it } from 'vitest'
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  formatJoinCode,
  generateJoinCode,
  isValidJoinCode,
  normalizeJoinCode,
} from '@/domain/join-code'

describe('JOIN_CODE_ALPHABET', () => {
  it('has 32 unique characters', () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(32)
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(32)
  })

  it('omits the visually ambiguous characters', () => {
    for (const character of ['I', 'O', '0', '1']) {
      expect(JOIN_CODE_ALPHABET).not.toContain(character)
    }
  })
})

describe('generateJoinCode', () => {
  it('produces a code of the documented length using only the alphabet', () => {
    const code = generateJoinCode()

    expect(code).toHaveLength(JOIN_CODE_LENGTH)
    for (const character of code) {
      expect(JOIN_CODE_ALPHABET).toContain(character)
    }
  })

  it('produces codes that pass validation', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(isValidJoinCode(generateJoinCode())).toBe(true)
    }
  })

  it('maps bytes onto the alphabet without bias, since 256 is a multiple of 32', () => {
    // Byte n and byte n + 32 must select the same character.
    const low = generateJoinCode(() => Uint8Array.from({ length: 16 }, (_, i) => i))
    const high = generateJoinCode(() => Uint8Array.from({ length: 16 }, (_, i) => i + 32))
    expect(low).toBe(high)

    const wrapped = generateJoinCode(() => Uint8Array.from({ length: 16 }, (_, i) => i + 224))
    expect(wrapped).toBe(low)
  })

  it('maps byte zero to the first character of the alphabet', () => {
    const code = generateJoinCode(() => new Uint8Array(16))
    expect(code).toBe('A'.repeat(16))
  })

  it('rejects a random source that returns the wrong number of bytes', () => {
    expect(() => generateJoinCode(() => new Uint8Array(8))).toThrow()
  })

  it('does not repeat itself across many draws', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateJoinCode()))
    expect(codes.size).toBe(500)
  })
})

describe('normalizeJoinCode', () => {
  it('uppercases the code', () => {
    expect(normalizeJoinCode('k7pfn4xqt3wmh9rc')).toBe('K7PFN4XQT3WMH9RC')
  })

  it('removes the display grouping', () => {
    expect(normalizeJoinCode('K7PF-N4XQ-T3WM-H9RC')).toBe('K7PFN4XQT3WMH9RC')
  })

  it('removes surrounding and interior whitespace', () => {
    expect(normalizeJoinCode('  K7PF N4XQ\tT3WM\nH9RC  ')).toBe('K7PFN4XQT3WMH9RC')
  })

  it('collapses every input variant onto the same document ID', () => {
    const canonical = 'K7PFN4XQT3WMH9RC'
    for (const variant of [
      'K7PFN4XQT3WMH9RC',
      'k7pf-n4xq-t3wm-h9rc',
      ' K7PF N4XQ T3WM H9RC ',
      'K7pfN4xqT3wmH9rc',
    ]) {
      expect(normalizeJoinCode(variant), variant).toBe(canonical)
    }
  })
})

describe('isValidJoinCode', () => {
  it('accepts a well-formed code', () => {
    expect(isValidJoinCode('K7PFN4XQT3WMH9RC')).toBe(true)
  })

  it('rejects the wrong length', () => {
    expect(isValidJoinCode('K7PFN4XQT3WMH9R')).toBe(false)
    expect(isValidJoinCode('K7PFN4XQT3WMH9RCX')).toBe(false)
    expect(isValidJoinCode('')).toBe(false)
  })

  it('rejects characters outside the alphabet', () => {
    for (const bad of [
      'K7PFN4XQT3WMH9R0',
      'K7PFN4XQT3WMH9R1',
      'K7PFN4XQT3WMH9RI',
      'K7PFN4XQT3WMH9RO',
      'k7pfn4xqt3wmh9rc',
      'K7PF-N4XQ-T3WM-H9R',
    ]) {
      expect(isValidJoinCode(bad), bad).toBe(false)
    }
  })

  it('rejects a value carrying a path separator', () => {
    expect(isValidJoinCode('K7PF/N4XQ/T3WM/H9')).toBe(false)
    expect(isValidJoinCode('../../organizations')).toBe(false)
  })
})

describe('formatJoinCode', () => {
  it('groups the code in fours for display', () => {
    expect(formatJoinCode('K7PFN4XQT3WMH9RC')).toBe('K7PF-N4XQ-T3WM-H9RC')
  })

  it('round-trips back to the document ID', () => {
    const code = generateJoinCode()
    expect(normalizeJoinCode(formatJoinCode(code))).toBe(code)
  })
})
