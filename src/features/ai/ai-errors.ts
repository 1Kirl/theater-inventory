import { FirebaseError } from 'firebase/app'

/**
 * Model failures, translated for a student technician.
 *
 * Nothing here repeats a prompt, a response, a token, or any Firebase
 * configuration: a message shown on screen is the wrong place for any of it.
 * The distinctions that matter to the person reading are "try again",
 * "something is misconfigured", and "wait a moment".
 */

export type AiFailureKind =
  | 'app-check'
  | 'not-enabled'
  | 'rate-limited'
  | 'daily-quota'
  | 'model-unavailable'
  | 'network'
  | 'malformed'
  | 'truncated'
  | 'partial'
  | 'empty'
  | 'unknown'

export interface AiFailure {
  kind: AiFailureKind
  message: string
}

export class AiOutputError extends Error {
  readonly kind: Extract<AiFailureKind, 'malformed' | 'truncated' | 'empty'>

  constructor(kind: 'malformed' | 'truncated' | 'empty', message: string) {
    super(message)
    this.name = 'AiOutputError'
    this.kind = kind
  }
}

const MESSAGES: Record<AiFailureKind, string> = {
  'app-check': 'This app could not verify itself with Google. Reload the page and try again.',
  'not-enabled': 'The AI service is not switched on for this project yet. An Admin needs to enable Firebase AI Logic.',
  'rate-limited': 'The AI assistant is busy right now. Wait a moment and try again.',
  'daily-quota': "Today's AI usage limit has been reached. Try again after the daily limit resets.",
  'model-unavailable': 'The AI model is unavailable at the moment. Try again later.',
  network: 'Could not reach the AI service. Check your connection and try again.',
  malformed: 'The AI response could not be read. Try again, or rephrase what you asked for.',
  truncated: 'The AI answer was cut off before anything usable arrived. Try a narrower question.',
  partial: 'Part of the AI answer could not be read. What is shown below is the part that was.',
  empty: 'The AI returned nothing usable. Try again with a bit more detail.',
  unknown: 'The AI assistant failed. Try again.',
}

function statusOf(error: FirebaseError): number | null {
  const data = (error as FirebaseError & { customErrorData?: { status?: unknown } }).customErrorData
  return typeof data?.status === 'number' ? data.status : null
}

/**
 * The quota identifiers the service named, if it named any.
 *
 * A 429 carries a `google.rpc.QuotaFailure` detail whose violations say which
 * limit was hit — `...RequestsPerMinute...` or `...RequestsPerDay...`. That
 * distinction is the difference between waiting a minute and waiting until
 * tomorrow, so it is worth reading rather than glossing.
 */
function quotaIdsOf(error: FirebaseError): string[] {
  const data = (error as FirebaseError & {
    customErrorData?: { errorDetails?: unknown }
  }).customErrorData

  if (!Array.isArray(data?.errorDetails)) return []

  const ids: string[] = []
  for (const entry of data.errorDetails) {
    const violations = (entry as { violations?: unknown })?.violations
    if (!Array.isArray(violations)) continue

    for (const violation of violations) {
      const id = (violation as { quotaId?: unknown })?.quotaId
      if (typeof id === 'string') ids.push(id)
    }
  }

  return ids
}

/** A per-day limit rather than a per-minute one. */
export function isDailyQuota(error: FirebaseError): boolean {
  return quotaIdsOf(error).some((id) => id.toLowerCase().includes('perday'))
}

/**
 * Classify a failure without leaking its detail.
 *
 * HTTP status carries the distinction the SDK does not: the AI SDK reports most
 * server rejections as one `fetch-error`, so 403, 404, and 429 have to be read
 * off the status to tell an App Check problem from a missing model from a quota.
 */
export function describeAiFailure(caught: unknown): AiFailure {
  if (caught instanceof AiOutputError) {
    return { kind: caught.kind, message: MESSAGES[caught.kind] }
  }

  if (caught instanceof FirebaseError) {
    if (caught.code.endsWith('api-not-enabled')) {
      return { kind: 'not-enabled', message: MESSAGES['not-enabled'] }
    }

    const status = statusOf(caught)
    if (status === 401 || status === 403) return { kind: 'app-check', message: MESSAGES['app-check'] }
    if (status === 404) return { kind: 'model-unavailable', message: MESSAGES['model-unavailable'] }
    if (status === 429) {
      // Only when the service said which limit it was. An unlabelled 429 keeps
      // the generic wording rather than guessing that the day is over.
      const kind = isDailyQuota(caught) ? 'daily-quota' : 'rate-limited'
      return { kind, message: MESSAGES[kind] }
    }
    if (status !== null && status >= 500) {
      return { kind: 'model-unavailable', message: MESSAGES['model-unavailable'] }
    }

    if (caught.code.endsWith('fetch-error')) {
      return { kind: 'network', message: MESSAGES.network }
    }

    return { kind: 'unknown', message: MESSAGES.unknown }
  }

  if (caught instanceof TypeError) {
    // fetch() rejects with a TypeError when the request never left the browser.
    return { kind: 'network', message: MESSAGES.network }
  }

  return { kind: 'unknown', message: MESSAGES.unknown }
}

export function aiFailureMessage(caught: unknown): string {
  return describeAiFailure(caught).message
}
