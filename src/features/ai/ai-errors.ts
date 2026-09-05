import { FirebaseError } from 'firebase/app'
import type { AiFeature } from '@/features/ai/ai-client'

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
  | 'timeout'
  | 'bad-request'
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

/**
 * What a failure says when the feature is not known.
 *
 * Smart Search adds a sentence to several of these, because its fallback is
 * real: the list, the search box, and the filters below it go on working with
 * no model involved, and somebody who has just been told the AI failed should
 * not conclude the page is broken. The generator has no such fallback — there
 * is nothing to draft requirements but the model — so it says nothing it cannot
 * back up.
 */
const MESSAGES: Record<AiFailureKind, string> = {
  'app-check': 'This app could not verify itself with Google. Reload the page and try again.',
  'not-enabled': 'The AI service is not switched on for this project yet. An Admin needs to enable Firebase AI Logic.',
  'rate-limited': 'AI is receiving too many requests right now. Please try again shortly.',
  'daily-quota': "Today's AI usage limit has been reached. AI will be available again after the daily quota resets.",
  'model-unavailable': 'The AI model is temporarily unavailable. Please try again later.',
  timeout: 'The AI request took too long to respond. Please try again.',
  'bad-request': 'The AI assistant could not accept that request. This is a fault in the app '
    + 'rather than something at your end, so trying again is unlikely to help.',
  network: 'AI could not be reached. Check your connection and try again.',
  malformed: 'The AI response could not be read. Try again, or rephrase what you asked for.',
  truncated: 'The AI answer was cut off before anything usable arrived. Try a narrower question.',
  partial: 'Part of the AI answer could not be read. What is shown below is the part that was.',
  empty: 'The AI returned nothing usable. Try again with a bit more detail.',
  unknown: 'The AI assistant failed. Try again.',
}

/** What Smart Search says instead, where the fallback is worth stating. */
const SMART_SEARCH_MESSAGES: Partial<Record<AiFailureKind, string>> = {
  'daily-quota': "Today's AI usage limit has been reached. AI search will be available again "
    + 'after the daily quota resets. The search and filters below still work without AI.',
  'rate-limited': 'AI is receiving too many requests right now. Please try again shortly. '
    + 'The search and filters below still work without AI.',
  'model-unavailable': 'The AI model is temporarily unavailable. Please try again later. '
    + 'The search and filters below still work without AI.',
  timeout: 'The AI request took too long to respond. Please try again. '
    + 'The search and filters below still work without AI.',
}

/** What the generator says instead, where its wording differs. */
const GENERATOR_MESSAGES: Partial<Record<AiFailureKind, string>> = {
  'daily-quota': "Today's AI usage limit has been reached. AI generation will be available "
    + 'again after the daily quota resets.',
}

function messageFor(kind: AiFailureKind, feature?: AiFeature): string {
  if (feature === 'smart-search') return SMART_SEARCH_MESSAGES[kind] ?? MESSAGES[kind]
  if (feature === 'requirement-generator') return GENERATOR_MESSAGES[kind] ?? MESSAGES[kind]
  return MESSAGES[kind]
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
function isDailyQuota(error: FirebaseError): boolean {
  return quotaIdsOf(error).some((id) => id.toLowerCase().includes('perday'))
}

/**
 * Whether this is the request being given up on rather than refused.
 *
 * The SDK bounds a request with an internal `AbortController` and, when it
 * fires, rethrows the `DOMException` **unchanged** — the abort branch of its
 * `makeRequest` deliberately skips the wrapping that every other failure gets.
 * So a timeout never arrives as a `FirebaseError` and carries no status; it is
 * an `AbortError`, and reading `name` is the structured way to see it.
 *
 * An externally aborted request would look identical. Nothing in this
 * application passes a signal today, so every abort reaching here is the
 * timeout — and if one ever does, "took too long" is still nearer the truth
 * than the generic failure this used to fall through to.
 */
function isAbort(caught: unknown): boolean {
  return caught instanceof Error && caught.name === 'AbortError'
}

/**
 * Classify a failure without leaking its detail.
 *
 * HTTP status carries the distinction the SDK does not: the AI SDK reports most
 * server rejections as one `fetch-error`, so 403, 404, and 429 have to be read
 * off the status to tell an App Check problem from a missing model from a quota.
 *
 * Every branch reads a structured field — `code`, `customErrorData.status`, the
 * `QuotaFailure` violations, `error.name`. None matches on the service's
 * human-readable message, which is free to be reworded upstream at any time.
 *
 * `feature` only chooses the wording. The classification is the same either way,
 * so the two features can never disagree about what happened.
 */
export function describeAiFailure(caught: unknown, feature?: AiFeature): AiFailure {
  const failure = (kind: AiFailureKind): AiFailure =>
    ({ kind, message: messageFor(kind, feature) })

  if (caught instanceof AiOutputError) return failure(caught.kind)

  // Before the FirebaseError check: an abort is a plain DOMException, but
  // checking it first keeps the ordering honest about what it is.
  if (isAbort(caught)) return failure('timeout')

  if (caught instanceof FirebaseError) {
    if (caught.code.endsWith('api-not-enabled')) return failure('not-enabled')

    const status = statusOf(caught)
    if (status === 401 || status === 403) return failure('app-check')
    if (status === 404) return failure('model-unavailable')
    if (status === 429) {
      // 429 is not one condition. Gemini uses it for a per-minute rate limit, a
      // per-day quota, and plain resource exhaustion, and only the first and
      // second differ in what the person should do about it. Claiming the day
      // is over on an unlabelled 429 would send somebody away for a whole day
      // over a limit that clears in a minute, so the day is only claimed when
      // the service names a per-day quota itself.
      return failure(isDailyQuota(caught) ? 'daily-quota' : 'rate-limited')
    }
    if (status !== null && status >= 500) return failure('model-unavailable')

    // The service read the request and refused it: a schema it will not accept,
    // a generation config out of range, something too large. Telling somebody to
    // check their connection sends them to look at the one thing that is
    // working, which is how a configuration fault gets mistaken for an outage.
    if (status !== null && status >= 400 && status < 500) return failure('bad-request')

    if (caught.code.endsWith('fetch-error')) return failure('network')

    return failure('unknown')
  }

  // fetch() rejects with a TypeError when the request never left the browser.
  if (caught instanceof TypeError) return failure('network')

  return failure('unknown')
}

export function aiFailureMessage(caught: unknown, feature?: AiFeature): string {
  return describeAiFailure(caught, feature).message
}
