import { describe, expect, it } from 'vitest'
import { requirementResponseSchema } from '@/features/ai/requirement-generator-service'
import {
  MAX_FINDINGS, MAX_INVENTORY_REFS, MAX_SUGGESTED_QTY, MAX_SUGGESTIONS,
  requirementSuggestionSchema,
} from '@/features/ai/requirement-generator'

/**
 * The response schema this application actually sends.
 *
 * Every request the Requirement Generator made was refused with HTTP 400,
 * "Request contains an invalid argument", while Smart Search succeeded on the
 * same model, backend, App Check, and session. Live bisection eliminated the
 * prompt, the request size, the schema expansion, `Schema.integer`, and
 * `minimum`/`maximum` one at a time. Removing `maxItems` was the single change
 * that made the request valid.
 *
 * This is an observation about this application's runtime — `@firebase/ai` 2.15
 * against `GoogleAIBackend` with `gemini-3.5-flash` — and not a claim about
 * every Gemini API or backend. It is worth a test because nothing local catches
 * it: the schema serializes to valid JSON, the SDK types accept `maxItems`, and
 * TypeScript is perfectly happy. Only the service says no.
 */

/** The serialized request, which is what the service actually receives. */
const wire = JSON.parse(JSON.stringify(requirementResponseSchema)) as Record<string, unknown>

function keywordsAt(node: unknown, path: string, out: Map<string, string[]>): void {
  if (typeof node !== 'object' || node === null) return
  const n = node as Record<string, unknown>
  out.set(path, Object.keys(n))

  if (n.properties) {
    for (const [key, value] of Object.entries(n.properties as Record<string, unknown>)) {
      keywordsAt(value, `${path}>${key}`, out)
    }
  }
  if (n.items) keywordsAt(n.items, `${path}[]`, out)
}

const everyNode = new Map<string, string[]>()
keywordsAt(wire, '$', everyNode)

describe('what the generator sends to the model', () => {
  it('carries no maxItems anywhere, at any depth', () => {
    // Not just the top-level array: the assertion that matters is recursive,
    // because the schema has arrays nested inside objects inside arrays.
    const offenders = [...everyNode]
      .filter(([, keywords]) => keywords.includes('maxItems'))
      .map(([path]) => path)

    expect(offenders).toEqual([])
    expect(JSON.stringify(wire)).not.toContain('maxItems')
  })

  it('carries no minItems either, which is the same keyword family', () => {
    expect(JSON.stringify(wire)).not.toContain('minItems')
  })

  it('keeps quantity an integer, because that is what it is', () => {
    // The string-quantity diagnostic also failed, so `Schema.integer` was never
    // the problem and the domain type has no reason to change.
    const qty = everyNode.get('$>suggestions[]>suggested_qty')
    expect(qty).toBeDefined()
    expect(JSON.stringify(wire)).toContain('"suggested_qty":{"type":"integer"')
  })

  it('leaves numeric bounds to the parser rather than the wire', () => {
    expect(JSON.stringify(wire)).not.toContain('"minimum"')
    expect(JSON.stringify(wire)).not.toContain('"maximum"')
  })

  it('uses only the keywords a request on this backend is known to survive', () => {
    // Smart Search works with exactly this vocabulary. Anything outside it has
    // not been shown to be accepted here, and `maxItems` is why that matters.
    const allowed = new Set([
      'type', 'description', 'nullable', 'required', 'properties', 'items', 'enum',
    ])

    const unexpected = [...everyNode]
      .flatMap(([path, keywords]) => keywords
        .filter((keyword) => !allowed.has(keyword))
        .map((keyword) => `${path}.${keyword}`))

    expect(unexpected).toEqual([])
  })
})

describe('the limits the model no longer promises', () => {
  it('are still enforced where they always mattered, in the parser', () => {
    // The model was never trusted to obey a bound; the parser slices. Removing
    // the wire hint costs nothing, and these constants are what the code uses.
    expect(MAX_SUGGESTIONS).toBeGreaterThan(0)
    expect(MAX_INVENTORY_REFS).toBeGreaterThan(0)
    expect(MAX_FINDINGS).toBeGreaterThan(0)
  })

  it('still refuse a quantity outside the domain range', () => {
    const base = { client_temp_id: 'tmp-1', item_name: 'XLR Cable' }

    expect(requirementSuggestionSchema.safeParse({ ...base, suggested_qty: 1 }).success).toBe(true)
    expect(requirementSuggestionSchema.safeParse({
      ...base, suggested_qty: MAX_SUGGESTED_QTY,
    }).success).toBe(true)

    for (const bad of [0, -1, 1.5, MAX_SUGGESTED_QTY + 1, '20', Number.NaN]) {
      expect(requirementSuggestionSchema.safeParse({ ...base, suggested_qty: bad }).success,
        String(bad)).toBe(false)
    }
  })
})
