import { describe, expect, it } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { buildAiDiagnostic, sanitizeMessage } from '@/features/ai/ai-diagnostics'
import { AiOutputError } from '@/features/ai/ai-errors'

/**
 * The diagnostic exists to name a failure precisely. These pin the part that
 * matters more: that naming it precisely does not leak anything.
 */

function aiError(code: string, custom?: Record<string, unknown>, message = 'boom'): FirebaseError {
  const error = new FirebaseError(code, message)
  if (custom) Object.assign(error, { customErrorData: custom })
  return error
}

describe('sanitizeMessage', () => {
  it('strips the request URL, which carries the project', () => {
    // The SDK builds its message as `Error fetching from <url>: [...]`, and that
    // URL contains the project ID and the model path.
    const raw = 'Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/'
      + 'my-real-project/models/gemini-3.5-flash:generateContent: [429 Too Many Requests] Quota exceeded.'

    const clean = sanitizeMessage(raw, 'my-real-project')

    expect(clean).not.toContain('googleapis.com')
    expect(clean).not.toContain('my-real-project')
    expect(clean).toContain('[url removed]')
    // The part worth reading survives.
    expect(clean).toContain('Quota exceeded')
  })

  it('removes the project ID wherever it appears', () => {
    expect(sanitizeMessage('project my-real-project failed', 'my-real-project'))
      .toBe('project [project removed] failed')
  })

  it('caps the length so nothing long rides along', () => {
    expect(sanitizeMessage('x'.repeat(1000)).length).toBe(400)
  })
})

describe('buildAiDiagnostic', () => {
  it('reports a 429 with the quota metadata the service supplied', () => {
    const error = aiError('AI/fetch-error', {
      status: 429,
      statusText: 'Too Many Requests',
      errorDetails: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{
            quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier',
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quotaValue: '10',
          }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' },
      ],
    })

    const diagnostic = buildAiDiagnostic(error)

    // Per-minute, so the generic wording is right.
    expect(diagnostic.kind).toBe('rate-limited')
    expect(diagnostic.status).toBe(429)
    expect(diagnostic.statusText).toBe('Too Many Requests')
    expect(diagnostic.details[0]?.quotaId).toContain('PerMinute')
    expect(diagnostic.details[1]?.retryDelay).toBe('31s')
  })

  it('reports the confirmed per-day free-tier quota distinctly', () => {
    const error = aiError('AI/fetch-error', {
      status: 429,
      statusText: 'Too Many Requests',
      errorDetails: [{
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaValue: '20',
        }],
      }],
    })

    const diagnostic = buildAiDiagnostic(error)

    expect(diagnostic.kind).toBe('daily-quota')
    expect(diagnostic.details[0]?.quotaId).toContain('PerDay')
    expect(diagnostic.details[0]?.quotaValue).toBe('20')
  })

  it('separates a 503 from a 429', () => {
    expect(buildAiDiagnostic(aiError('AI/fetch-error', { status: 503 })).kind)
      .toBe('model-unavailable')
    expect(buildAiDiagnostic(aiError('AI/fetch-error', { status: 429 })).kind)
      .toBe('rate-limited')
  })

  it('separates App Check from both', () => {
    expect(buildAiDiagnostic(aiError('AI/fetch-error', { status: 403 })).kind).toBe('app-check')
  })

  it('reports a request that never left the browser', () => {
    const diagnostic = buildAiDiagnostic(aiError('AI/fetch-error'))
    expect(diagnostic.kind).toBe('network')
    expect(diagnostic.status).toBeNull()
  })

  it('surfaces a finish reason when the response carried one', () => {
    const diagnostic = buildAiDiagnostic(aiError('AI/response-error', {
      response: { candidates: [{ finishReason: 'SAFETY' }] },
    }))
    expect(diagnostic.finishReason).toBe('SAFETY')
  })

  it('names truncation as the finish reason it was', () => {
    const diagnostic = buildAiDiagnostic(new AiOutputError('truncated', 'cut off'))
    expect(diagnostic.kind).toBe('truncated')
    expect(diagnostic.finishReason).toBe('MAX_TOKENS')
  })

  it('carries no prompt, inventory, token, or configuration', () => {
    const error = aiError(
      'AI/fetch-error',
      { status: 429 },
      'Error fetching from https://host/v1beta/projects/proj-1/models/x: [429] quota',
    )

    const serialized = JSON.stringify(buildAiDiagnostic(error, 'proj-1'))

    for (const forbidden of ['proj-1', 'https://', 'AIza', 'INVENTORY_DATA', 'USER_QUERY']) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
