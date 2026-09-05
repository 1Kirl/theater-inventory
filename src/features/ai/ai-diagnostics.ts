import { FirebaseError } from 'firebase/app'
import { AiOutputError, describeAiFailure } from '@/features/ai/ai-errors'
import { AI_REQUEST_TIMEOUT_MS } from '@/features/ai/ai-client'

/**
 * Development-only diagnostics for an AI failure.
 *
 * The messages shown on screen deliberately say nothing about why: "busy right
 * now" is what a student technician needs, and repeating a service response into
 * the UI is how request detail escapes. That leaves nobody able to tell a
 * per-minute rate limit from an exhausted daily quota, which is a real question
 * when the answer decides whether to wait a minute or wait a day.
 *
 * This prints the classification and the service's own metadata, in development
 * only. `import.meta.env.DEV` is resolved at build time, so the whole function
 * body is eliminated from a production bundle.
 *
 * What is printed: the Firebase error code, HTTP status and status text, the
 * service's `error.details` reasons, and a finish reason when there is one.
 *
 * What is never printed: prompts, inventory, App Check tokens, Firebase
 * configuration, or anything about a user. The SDK's own message embeds the
 * request URL, which carries the project ID, so URLs are stripped before
 * anything is shown.
 */

interface ServiceDetail {
  type: string | null
  reason: string | null
  /** Quota metadata for a 429: which limit, and how long to wait. */
  quotaId: string | null
  quotaMetric: string | null
  quotaValue: string | null
  retryDelay: string | null
}

const URL_PATTERN = /https?:\/\/\S+/g

/** Remove anything that could carry configuration out of a message. */
export function sanitizeMessage(message: string, projectId?: string | null): string {
  let output = message.replace(URL_PATTERN, '[url removed]')
  if (projectId) output = output.split(projectId).join('[project removed]')
  return output.slice(0, 400)
}

function readDetails(error: FirebaseError): ServiceDetail[] {
  const data = (error as FirebaseError & {
    customErrorData?: { errorDetails?: unknown }
  }).customErrorData

  if (!Array.isArray(data?.errorDetails)) return []

  return data.errorDetails.slice(0, 5).map((entry) => {
    const detail = (entry ?? {}) as Record<string, unknown>
    const violations = Array.isArray(detail.violations)
      ? (detail.violations[0] ?? {}) as Record<string, unknown>
      : {}

    return {
      type: typeof detail['@type'] === 'string' ? detail['@type'] : null,
      reason: typeof detail.reason === 'string' ? detail.reason : null,
      quotaId: typeof violations.quotaId === 'string' ? violations.quotaId : null,
      quotaMetric: typeof violations.quotaMetric === 'string' ? violations.quotaMetric : null,
      quotaValue: typeof violations.quotaValue === 'string' ? violations.quotaValue : null,
      retryDelay: typeof detail.retryDelay === 'string' ? detail.retryDelay : null,
    }
  })
}

export interface AiDiagnostic {
  kind: string
  code: string | null
  status: number | null
  statusText: string | null
  finishReason: string | null
  details: ServiceDetail[]
  serviceMessage: string | null
}

/** Build the sanitized diagnostic. Pure, so it can be tested. */
export function buildAiDiagnostic(caught: unknown, projectId?: string | null): AiDiagnostic {
  const kind = describeAiFailure(caught).kind

  if (caught instanceof AiOutputError) {
    return {
      kind,
      code: 'AiOutputError',
      status: null,
      statusText: null,
      finishReason: caught.kind === 'truncated' ? 'MAX_TOKENS' : null,
      details: [],
      serviceMessage: null,
    }
  }

  if (caught instanceof FirebaseError) {
    const data = (caught as FirebaseError & {
      customErrorData?: { status?: unknown; statusText?: unknown; response?: unknown }
    }).customErrorData

    const response = (data?.response ?? {}) as { candidates?: { finishReason?: unknown }[] }
    const finishReason = response.candidates?.[0]?.finishReason

    return {
      kind,
      code: caught.code,
      status: typeof data?.status === 'number' ? data.status : null,
      statusText: typeof data?.statusText === 'string' ? data.statusText : null,
      finishReason: typeof finishReason === 'string' ? finishReason : null,
      details: readDetails(caught),
      serviceMessage: sanitizeMessage(caught.message, projectId),
    }
  }

  return {
    kind,
    code: caught instanceof Error ? caught.name : null,
    status: null,
    statusText: null,
    finishReason: null,
    details: [],
    serviceMessage: caught instanceof Error ? sanitizeMessage(caught.message, projectId) : null,
  }
}

/**
 * Print the diagnostic in development. Does nothing in a production build.
 *
 * The UI message is unchanged by this; it is an extra line in the console for
 * whoever is looking.
 */
export function reportAiFailure(
  caught: unknown,
  feature: string,
  /**
   * How long the request ran before it failed.
   *
   * The one thing the error object never says, and the one that separates "the
   * service refused us immediately" from "we waited out the timeout". Optional
   * so an existing caller that has not measured it still reports everything
   * else.
   */
  elapsedMs?: number,
): void {
  if (!import.meta.env.DEV) return

  const diagnostic = buildAiDiagnostic(caught, import.meta.env.VITE_FIREBASE_PROJECT_ID)

  console.groupCollapsed(`[AI diagnostic] ${feature}: ${diagnostic.kind}`)
  console.table({
    feature,
    classified_as: diagnostic.kind,
    firebase_code: diagnostic.code ?? '(none)',
    http_status: diagnostic.status ?? '(none)',
    http_status_text: diagnostic.statusText ?? '(none)',
    finish_reason: diagnostic.finishReason ?? '(none)',
    elapsed_ms: elapsedMs ?? '(not measured)',
    timeout_ms: AI_REQUEST_TIMEOUT_MS,
  })

  if (diagnostic.details.length > 0) console.table(diagnostic.details)
  if (diagnostic.serviceMessage) {
    console.info('service message (URLs and project removed):', diagnostic.serviceMessage)
  }

  console.info(
    'Nothing above includes a prompt, inventory data, an App Check token,'
      + ' Firebase configuration, or user information.',
  )
  console.groupEnd()
}
