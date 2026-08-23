import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INVENTORY_CATEGORIES } from '@/types/inventory'

/**
 * The category list lives in three places — PROJECT_SPEC section 7.4, the
 * application, and Security Rules — and they have to agree. Rules cannot import
 * the constant, so this reads the rules file and compares.
 */
describe('inventory category set', () => {
  it('holds the twelve MVP categories', () => {
    expect(INVENTORY_CATEGORIES).toHaveLength(12)
    expect(new Set(INVENTORY_CATEGORIES).size).toBe(12)
  })

  it('matches the allowlist in firestore.rules exactly', () => {
    const rules = readFileSync('firestore.rules', 'utf8')
    const block = rules.match(/function isAllowedCategory\(category\) \{[\s\S]*?\];/)

    expect(block, 'isAllowedCategory not found in firestore.rules').not.toBeNull()

    const inRules = [...(block?.[0].matchAll(/'([^']+)'/g) ?? [])].map((match) => match[1])

    expect(inRules).toEqual([...INVENTORY_CATEGORIES])
  })

  it('is documented as the fixed set in PROJECT_SPEC', () => {
    const spec = readFileSync('docs/PROJECT_SPEC.md', 'utf8')
    for (const category of INVENTORY_CATEGORIES) {
      expect(spec, `${category} missing from PROJECT_SPEC`).toContain(category)
    }
  })
})
