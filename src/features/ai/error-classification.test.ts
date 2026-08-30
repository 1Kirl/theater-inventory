import { describe, expect, it } from 'vitest'
import { FirebaseError } from 'firebase/app'
import { describeAiFailure } from '@/features/ai/ai-errors'

/**
 * Telling somebody the right thing about a failure.
 *
 * The distinction these tests exist for cost a diagnosis: a request the service
 * read and refused was reported as "check your connection", which sends the
 * reader to inspect the one part of the system that is demonstrably working.
 * A 4xx is a fault in what was sent; only a request that never got an answer is
 * a connection problem.
 */

function firebaseError(code: string, status?: number, statusText?: string) {
  const error = new FirebaseError(code, 'something went wrong')
  if (status !== undefined) {
    Object.assign(error, { customErrorData: { status, statusText } })
  }
  return error
}

describe('a request the service read and refused', () => {
  it.each([400, 422])('is not reported as a connection problem (%i)', (status) => {
    const failure = describeAiFailure(firebaseError('AI/fetch-error', status, 'Bad Request'))

    expect(failure.kind).toBe('bad-request')
    expect(failure.message).not.toContain('connection')
    expect(failure.message).toContain('fault in the app')
  })

  it('says that retrying will not help, because it will not', () => {
    const failure = describeAiFailure(firebaseError('AI/fetch-error', 400))
    expect(failure.message).toContain('unlikely to help')
  })
})

describe('the failures that were already classified', () => {
  it.each([
    [401, 'app-check'],
    [403, 'app-check'],
    [404, 'model-unavailable'],
    [429, 'rate-limited'],
    [500, 'model-unavailable'],
    [503, 'model-unavailable'],
  ] as [number, string][])('still reads %i as %s', (status, kind) => {
    expect(describeAiFailure(firebaseError('AI/fetch-error', status)).kind).toBe(kind)
  })

  it('still reads a request that never arrived as a connection problem', () => {
    // No status at all: the fetch itself failed, which is the one case where
    // checking the connection is the right advice.
    expect(describeAiFailure(firebaseError('AI/fetch-error')).kind).toBe('network')
    expect(describeAiFailure(new TypeError('Failed to fetch')).kind).toBe('network')
  })

  it('still reads a disabled service as a disabled service', () => {
    expect(describeAiFailure(firebaseError('AI/api-not-enabled')).kind).toBe('not-enabled')
  })
})

describe('what every message avoids', () => {
  it('never repeats a service response, a URL, or a project', () => {
    const noisy = new FirebaseError(
      'AI/fetch-error',
      'Failed to fetch https://generativelanguage.googleapis.com/v1beta/projects/theater-inventory',
    )
    Object.assign(noisy, { customErrorData: { status: 400 } })

    const failure = describeAiFailure(noisy)
    expect(failure.message).not.toContain('http')
    expect(failure.message).not.toContain('theater-inventory')
    expect(failure.message).not.toContain('googleapis')
  })
})
