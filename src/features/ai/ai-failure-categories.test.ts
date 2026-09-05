import { describe, expect, it, vi } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { AI_REQUEST_TIMEOUT_MS } from '@/features/ai/ai-client'
import { describeAiFailure } from '@/features/ai/ai-errors'
import { askInventoryQuestion } from '@/features/ai/smart-search-service'
import { generateRequirementDraft } from '@/features/ai/requirement-generator-service'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'

/**
 * How an AI failure is named, and how long the user waits to be told.
 *
 * Two things were wrong and both are asserted here. The SDK bounds a request at
 * 180 seconds by default, which is a batch-job ceiling applied to a button
 * press; and a request that hit that ceiling arrived as a bare `AbortError`
 * that nothing classified, so three minutes of waiting ended in the generic
 * "the AI assistant failed".
 *
 * Every classification below reads a structured field — an HTTP status, a
 * `QuotaFailure` violation, an error name. None depends on the wording of a
 * service message, which upstream is free to change without telling anybody.
 */

function fetchError(status: number, details?: unknown[]): FirebaseError {
  const error = new FirebaseError('AI/fetch-error', `Error fetching from [url]: [${status}]`)
  Object.assign(error, {
    customErrorData: { status, statusText: 'x', ...(details ? { errorDetails: details } : {}) },
  })
  return error
}

const quota = (quotaId: string) => [{
  '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
  violations: [{ quotaId }],
}]

describe('the six failures a user can act on', () => {
  it('1. an explicitly per-day 429 is the day being spent', () => {
    const failure = describeAiFailure(
      fetchError(429, quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier')),
    )

    expect(failure.kind).toBe('daily-quota')
  })

  it('2. a 429 that does not name a per-day limit is a temporary rate limit', () => {
    // The distinction that decides whether somebody waits a minute or gives up
    // for the day. 429 alone does not carry it: Gemini uses the same status for
    // a per-minute limit, a per-day quota, and plain resource exhaustion.
    expect(describeAiFailure(fetchError(429)).kind).toBe('rate-limited')
    expect(describeAiFailure(
      fetchError(429, quota('GenerateRequestsPerMinutePerProjectPerModel-FreeTier')),
    ).kind).toBe('rate-limited')
    expect(describeAiFailure(
      fetchError(429, [{ reason: 'RATE_LIMIT_EXCEEDED' }]),
    ).kind).toBe('rate-limited')
  })

  it('3. a 503 is the model being unavailable', () => {
    expect(describeAiFailure(fetchError(503)).kind).toBe('model-unavailable')
    expect(describeAiFailure(fetchError(500)).kind).toBe('model-unavailable')
  })

  it('4. an aborted request is a timeout', () => {
    // What the SDK actually throws when its own timeout fires: the abort branch
    // of `makeRequest` rethrows the DOMException unwrapped, so this never
    // arrives as a FirebaseError and never carries a status.
    const aborted = new Error('Timeout has expired.')
    aborted.name = 'AbortError'

    expect(describeAiFailure(aborted).kind).toBe('timeout')
  })

  it('5. a request that never left the browser is a network error', () => {
    expect(describeAiFailure(new TypeError('Failed to fetch')).kind).toBe('network')
    expect(describeAiFailure(new FirebaseError('AI/fetch-error', 'x')).kind).toBe('network')
  })

  it('6. anything unrecognised stays unknown rather than claiming an outage', () => {
    // The failure mode this guards: calling every unexplained problem "the model
    // is unavailable" sends people to wait for a service that is fine.
    for (const caught of [new Error('boom'), 'a string', null, undefined, { code: 7 }]) {
      const failure = describeAiFailure(caught)
      expect(failure.kind, String(caught)).toBe('unknown')
      expect(failure.message, String(caught)).not.toMatch(/unavailable/i)
    }
  })
})

describe('what each feature says', () => {
  const daily = fetchError(429, quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'))

  it('7. Smart Search says its search and filters still work', () => {
    // The graceful degradation is real and worth stating: the list below the
    // panel is rendered from Firestore and never involved the model.
    for (const caught of [daily, fetchError(503), fetchError(429), abort()]) {
      expect(describeAiFailure(caught, 'smart-search').message)
        .toMatch(/search and filters below still work without AI/)
    }
  })

  it('8. the generator says what it can, and promises no fallback it lacks', () => {
    const message = describeAiFailure(daily, 'requirement-generator').message

    expect(message).toContain('AI generation will be available again after the daily quota resets')
    expect(message).not.toMatch(/filters below/)
  })

  it('names the same failure identically whoever asks', () => {
    // Only the wording is per-feature. If the classification differed, the two
    // features could disagree about what happened.
    for (const caught of [daily, fetchError(503), fetchError(429), abort()]) {
      expect(describeAiFailure(caught, 'smart-search').kind)
        .toBe(describeAiFailure(caught, 'requirement-generator').kind)
    }
  })

  it('promises no reset clock time, because the API gives none', () => {
    for (const feature of ['smart-search', 'requirement-generator'] as const) {
      expect(describeAiFailure(daily, feature).message).not.toMatch(/\d+\s*(hour|minute|am|pm|:)/i)
    }
  })
})

function abort(): Error {
  const error = new Error('Timeout has expired.')
  error.name = 'AbortError'
  return error
}

describe('the request is bounded well short of the SDK default', () => {
  it('sets an explicit timeout rather than inheriting 180 seconds', () => {
    // The SDK's own default is DEFAULT_FETCH_TIMEOUT_MS = 180_000. Three
    // minutes of spinner on a button press reads as a hang, and the usual
    // response is to reload — which throws the request away.
    //
    // That it is handed to the SDK rather than raced against is asserted in
    // `tests/unit/ai-loading-feedback.test.ts`, which can read the file: this
    // project has no Node types, deliberately.
    expect(AI_REQUEST_TIMEOUT_MS).toBe(30_000)
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThan(180_000)
  })
})

describe('one user action makes one request', () => {
  const items = [{
    item_id: 'i-1',
    organization_id: 'org-1',
    name: 'XLR Cable',
    category: 'Cables',
    team_id: 't-sound',
    quantity_total: 4,
    quantity_available: 4,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 4 },
    location: 'Storage Room A',
    created_by_uid: 'u-1',
  }] as unknown as InventoryItem[]

  it('9. Smart Search calls the model once and gives up on failure', async () => {
    const generate = vi.fn().mockRejectedValue(fetchError(503))

    await expect(askInventoryQuestion({
      query: 'what is broken?', items, units: [], teams: [], generate,
    })).rejects.toBeDefined()

    // No retry loop hidden anywhere: a temporary 503 is reported so the person
    // can decide, rather than silently costing them three more waits.
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('10. the generator calls the model once and gives up on failure', async () => {
    const generate = vi.fn().mockRejectedValue(fetchError(503))

    await expect(generateRequirementDraft({
      production: { title: 'Into the Woods', description: '', notes: '' },
      teams: [{ team_id: 't-sound', name: 'Sound' }] as never,
      existingItemNames: [],
      userPrompt: 'a small musical with live vocals',
      items,
      canReadInventory: true,
      plan: null,
      generate,
    })).rejects.toBeDefined()

    expect(generate).toHaveBeenCalledTimes(1)
  })
})
