import { describe, expect, it } from 'vitest'
import { requirementSuggestionSchema } from '@/features/ai/requirement-generator'
import { parseRequirementResponse } from '@/features/ai/requirement-generator-service'

/**
 * The boundaries the Requirement Generator must keep, stated as tests.
 *
 * The generator drafts equipment lists for a person to approve. It has never
 * been allowed to price anything, name a document, or decide what work happens
 * — and after Phase 11F added cost fields to the product, "it cannot invent a
 * price" stopped being obvious from the absence of a field and became something
 * worth proving.
 */

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    client_temp_id: 'tmp-1',
    item_name: 'Wireless Handheld Microphone',
    suggested_qty: 4,
    ...overrides,
  }
}

describe('what a suggestion may contain', () => {
  it('accepts the fields the generator is for', () => {
    const parsed = requirementSuggestionSchema.safeParse(suggestion({
      category: 'Microphones',
      suggested_team_name: 'Sound',
      rationale: 'The cast is larger than the four handhelds they own.',
      suggested_action: 'buy',
    }))

    expect(parsed.success).toBe(true)
  })

  it('has no field for a price, and refuses one offered', () => {
    // Phase 11F stores costs in cents, entered by a person. A model guessing at
    // one would put a number nobody can stand behind into a production budget.
    for (const priced of [
      { estimated_unit_cost_cents: 24900 },
      { unit_cost_cents: 24900 },
      { estimated_price: '249.00' },
      { price: 249 },
      { cost: 249.99 },
      { estimated_total_cost_cents: 99600 },
    ]) {
      const parsed = requirementSuggestionSchema.safeParse(suggestion(priced))
      expect(parsed.success, JSON.stringify(priced)).toBe(false)
    }
  })

  it('refuses an identifier the application owns', () => {
    for (const identified of [
      { item_id: 'itemLIGHTINGAAAAAAAA' },
      { inventory_item_id: 'itemLIGHTINGAAAAAAAA' },
      { unit_id: 'unitLIGHTINGAAAAAAAA' },
      { action_item_id: 'reqSHORTAAAAAAAAAAA1' },
      { requirement_id: 'reqSHORTAAAAAAAAAAA1' },
      { asset_code: 'MIC-017' },
    ]) {
      const parsed = requirementSuggestionSchema.safeParse(suggestion(identified))
      expect(parsed.success, JSON.stringify(identified)).toBe(false)
    }
  })

  it('refuses a vendor or a purchase order, which are not this product', () => {
    expect(requirementSuggestionSchema.safeParse(suggestion({ vendor: 'Sweetwater' })).success)
      .toBe(false)
    expect(requirementSuggestionSchema.safeParse(suggestion({ purchase_order: 'PO-1' })).success)
      .toBe(false)
  })

  it('refuses a lifecycle instruction, which the model does not get to give', () => {
    expect(requirementSuggestionSchema.safeParse(suggestion({ status: 'in_use' })).success)
      .toBe(false)
    expect(requirementSuggestionSchema.safeParse(suggestion({ new_status: 'retired' })).success)
      .toBe(false)
  })

  it('refuses a document id smuggled inside a text field', () => {
    // Twenty characters mixing case and digits, which is what a Firestore id
    // looks like and what an ordinary equipment name never does.
    expect(requirementSuggestionSchema.safeParse(suggestion({
      item_name: 'a1B2c3D4e5F6g7H8i9J0',
    })).success).toBe(false)
  })

  it('refuses a quantity that is not a real count', () => {
    for (const bad of [0, -1, 1.5, 100000, Number.NaN]) {
      expect(requirementSuggestionSchema.safeParse(suggestion({ suggested_qty: bad })).success,
        String(bad)).toBe(false)
    }
  })

  it('tolerates an unfamiliar category, because it is only a hint', () => {
    // The Gemini schema constrains this to the product's categories, and the
    // reviewer picks the real one when saving. A requirement has no category
    // field at all, so an odd value here reaches nothing — dropping the whole
    // suggestion over it would lose a useful equipment line for no gain.
    const parsed = requirementSuggestionSchema.safeParse(suggestion({ category: 'Pyrotechnics' }))
    expect(parsed.success).toBe(true)
  })

  it('refuses an action type the product does not define', () => {
    expect(requirementSuggestionSchema.safeParse(suggestion({ suggested_action: 'lease' })).success)
      .toBe(false)
  })
})

describe('one priced row does not discard the rest', () => {
  it('keeps the usable suggestions and counts the one it dropped', () => {
    // Salvage is per suggestion by design, so a model that prices one line
    // costs the reviewer that line and nothing else.
    const response = JSON.stringify({
      summary: 'They need more microphones.',
      suggestions: [
        suggestion({ client_temp_id: 'tmp-1' }),
        suggestion({ client_temp_id: 'tmp-2', estimated_unit_cost_cents: 24900 }),
        suggestion({ client_temp_id: 'tmp-3' }),
      ],
    })

    const parsed = parseRequirementResponse(response)

    expect(parsed.suggestions).toHaveLength(2)
    expect(parsed.discardedCount).toBe(1)
    expect(parsed.suggestions.map((s) => s.client_temp_id)).toEqual(['tmp-1', 'tmp-3'])
  })

  it('refuses the whole response when every row carried a price', () => {
    const response = JSON.stringify({
      summary: 'x',
      suggestions: [suggestion({ estimated_unit_cost_cents: 24900 })],
    })

    // Nothing invents a price, and nothing quietly launders one out either.
    // With nothing usable left the call fails rather than presenting an empty
    // list as though the model had found nothing to suggest.
    expect(() => parseRequirementResponse(response)).toThrow()
  })
})
