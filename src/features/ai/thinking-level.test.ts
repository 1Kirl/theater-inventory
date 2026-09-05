import { describe, expect, it, vi } from 'vitest'
import { ThinkingLevel } from 'firebase/ai'
import { askInventoryQuestion } from '@/features/ai/smart-search-service'
import { generateRequirementDraft } from '@/features/ai/requirement-generator-service'
import { AI_REQUEST_TIMEOUT_MS } from '@/features/ai/ai-client'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { StructuredRequest } from '@/features/ai/ai-client'
import type { InventoryItem } from '@/types/inventory'

/**
 * How much each feature is allowed to deliberate.
 *
 * The two share one client, so the setting is per request and the risk is that
 * one feature's choice quietly becomes both. Smart Search reads an answer out
 * of a list it was handed and wants the model to stop thinking and look; the
 * Requirement Generator drafts a production's needs from a sentence, where the
 * thinking is most of the value. A test that only checked Smart Search would
 * pass just as happily if the generator had been dragged along with it.
 */

const items = [{
  item_id: 'i-1', organization_id: 'org-1', name: 'XLR Cable', category: 'Cables',
  team_id: 't-sound', quantity_total: 4, quantity_available: 4,
  condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 4 },
  location: 'Storage Room A', created_by_uid: 'u-1',
}] as unknown as InventoryItem[]

/** Captures the request without reaching the network. */
function capture() {
  const seen: StructuredRequest[] = []
  const generate = vi.fn(async (request: StructuredRequest) => {
    seen.push(request)
    return { text: '{}', truncated: false }
  })
  return { seen, generate }
}

async function smartSearchRequest(): Promise<StructuredRequest> {
  const { seen, generate } = capture()
  await askInventoryQuestion({ query: 'what needs repair?', items, units: [], teams: [], generate })
    .catch(() => undefined)
  return seen[0] as StructuredRequest
}

async function generatorRequest(): Promise<StructuredRequest> {
  const { seen, generate } = capture()
  await generateRequirementDraft({
    production: { title: 'Into the Woods', description: '', notes: '' },
    teams: [{ team_id: 't-sound', name: 'Sound' }] as never,
    existingItemNames: [],
    userPrompt: 'a small musical',
    items,
    canReadInventory: true,
    plan: null,
    generate,
  }).catch(() => undefined)
  return seen[0] as StructuredRequest
}

describe('thinking level is chosen per feature', () => {
  it('1. Smart Search asks for minimal thinking', async () => {
    const request = await smartSearchRequest()

    expect(request.thinkingLevel).toBe(ThinkingLevel.MINIMAL)
    // The SDK's own enum rather than a bare string, so a renamed member is a
    // compile error instead of a value the service quietly rejects.
    expect(ThinkingLevel.MINIMAL).toBe('MINIMAL')
  })

  it('2. the Requirement Generator does not inherit it', async () => {
    const request = await generatorRequest()

    // Absent, not MEDIUM: saying nothing leaves the model's own default, which
    // is what this feature wants and what it had before Smart Search changed.
    expect(request.thinkingLevel).toBeUndefined()
  })

  it('sets a thinking level for exactly one of the two features', async () => {
    const [search, generator] = await Promise.all([smartSearchRequest(), generatorRequest()])
    const configured = [search, generator].filter((r) => r.thinkingLevel !== undefined)

    expect(configured).toHaveLength(1)
    expect(configured[0]?.feature).toBe('smart-search')
  })
})

describe('nothing else about the request moved', () => {
  // The model name is asserted in `tests/unit/ai-loading-feedback.test.ts`,
  // which can read the client's source; this project has no Node types.

  it('4. the timeout is still thirty seconds', () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBe(30_000)
  })

  it('5. the response schema and output budget are unchanged', async () => {
    const request = await smartSearchRequest()

    expect(request.maxOutputTokens).toBe(8192)
    expect(request.responseSchema).toBeDefined()
    // The three fields the parser and the resolver both depend on.
    const schema = request.responseSchema as unknown as { properties?: Record<string, unknown> }
    expect(Object.keys(schema.properties ?? {}).sort())
      .toEqual(['answer', 'interpreted_filters', 'matches'])
  })

  it('keeps the prompt and system instruction the feature already had', async () => {
    const request = await smartSearchRequest()

    expect(request.systemInstruction.length).toBeGreaterThan(3000)
    expect(request.prompt).toContain('USER_QUERY')
  })
})
