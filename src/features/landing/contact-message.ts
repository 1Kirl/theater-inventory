/**
 * The contact form's one boundary with the outside world.
 *
 * This project runs on Firebase's Spark plan with no server code, so it has no
 * way to send email by itself — and an SMTP login or a provider's private key
 * in the page would be readable by every visitor. Delivery is therefore left to
 * a form-to-email service that the recipient signs up for: the service is given
 * the recipient's address privately, and issues a public endpoint that accepts
 * a form post. Only that public endpoint is configured here, through
 * `VITE_CONTACT_FORM_ENDPOINT`. The recipient's address never appears in this
 * repository or in the bundle.
 *
 * Until that variable is set, `configuredContactTransport()` returns null and
 * the form says plainly that it cannot send yet. It never pretends a message
 * went somewhere it did not.
 *
 * The endpoint must accept a JSON POST of `{ name, title, message }` and answer
 * 2xx only once the message has been accepted for delivery. Anything else — a
 * non-2xx status, a network failure, a timeout — is reported as a failure.
 *
 * Abuse is limited here only as far as a page can limit it: bounded lengths, a
 * hidden honeypot field, and one request in flight at a time. Rate limiting and
 * spam filtering belong to the provider, which is the only party that sees
 * every submission.
 */

export const CONTACT_LIMITS = {
  name: 80,
  title: 120,
  message: 4000,
} as const

export type ContactField = keyof typeof CONTACT_LIMITS

export interface ContactMessage {
  readonly name: string
  readonly title: string
  readonly message: string
}

export interface ContactDraft extends ContactMessage {
  /** The honeypot. Hidden from people; bots that fill every field fill it. */
  readonly website: string
}

export type ContactErrors = Partial<Record<ContactField, string>>

export type ContactValidation =
  | { readonly ok: true; readonly value: ContactMessage }
  | { readonly ok: false; readonly errors: ContactErrors; readonly spam: boolean }

const LABELS: Record<ContactField, string> = {
  name: 'Name',
  title: 'Title',
  message: 'Message',
}

/** Trim, require, and bound every field. Pure. */
export function validateContactDraft(draft: ContactDraft): ContactValidation {
  // A filled honeypot is refused before anything else, and never sent.
  if (draft.website.trim() !== '') return { ok: false, errors: {}, spam: true }

  const value = {
    name: draft.name.trim(),
    title: draft.title.trim(),
    message: draft.message.trim(),
  }
  const errors: ContactErrors = {}

  for (const field of Object.keys(CONTACT_LIMITS) as ContactField[]) {
    const text = value[field]
    if (text === '') errors[field] = `${LABELS[field]} is required.`
    else if (text.length > CONTACT_LIMITS[field]) {
      errors[field] = `${LABELS[field]} must be ${CONTACT_LIMITS[field]} characters or fewer.`
    }
  }

  return Object.keys(errors).length === 0
    ? { ok: true, value }
    : { ok: false, errors, spam: false }
}

/** Sends one message. Resolves on accepted delivery, rejects on anything else. */
export type ContactTransport = (message: ContactMessage) => Promise<void>

const TIMEOUT_MS = 15_000

/**
 * Whether a configured endpoint is one it is safe to post a visitor's message
 * to. HTTPS only, except plain HTTP on a loopback host for local testing.
 */
export function isUsableEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function endpointTransport(
  endpoint: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ContactTransport {
  return async (message) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      })
      // The status only. The body is the provider's business, and nothing
      // about the visitor's message is ever written to the console.
      if (!response.ok) throw new Error(`Contact delivery failed with status ${response.status}`)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** The transport the build was configured with, or null when there is none. */
export function configuredContactTransport(
  endpoint: string | undefined = import.meta.env.VITE_CONTACT_FORM_ENDPOINT,
): ContactTransport | null {
  if (!endpoint || !isUsableEndpoint(endpoint.trim())) return null
  return endpointTransport(endpoint.trim())
}

/*
 * The form's states, as a reducer, so the rules that matter — one request in
 * flight, no success without a delivery, errors that clear as they are fixed —
 * can be checked without rendering anything.
 */

export type ContactStatus = 'unavailable' | 'idle' | 'submitting' | 'sent' | 'failed'

export interface ContactState {
  readonly status: ContactStatus
  readonly errors: ContactErrors
}

export type ContactAction =
  | { readonly type: 'submit' }
  | { readonly type: 'invalid'; readonly errors: ContactErrors }
  | { readonly type: 'delivered' }
  | { readonly type: 'rejected' }
  | { readonly type: 'edit'; readonly field: ContactField }
  | { readonly type: 'reset' }

export function initialContactState(available: boolean): ContactState {
  return { status: available ? 'idle' : 'unavailable', errors: {} }
}

export function contactReducer(state: ContactState, action: ContactAction): ContactState {
  // With nowhere to send, nothing moves the form out of `unavailable`.
  if (state.status === 'unavailable') return state

  switch (action.type) {
    case 'submit':
      // A second press while one is in flight does nothing.
      return state.status === 'submitting' ? state : { status: 'submitting', errors: {} }
    case 'invalid':
      return { status: 'idle', errors: action.errors }
    case 'delivered':
      return state.status === 'submitting' ? { status: 'sent', errors: {} } : state
    case 'rejected':
      return state.status === 'submitting' ? { status: 'failed', errors: {} } : state
    case 'edit': {
      if (!(action.field in state.errors)) return state
      const errors = { ...state.errors }
      delete errors[action.field]
      return { ...state, errors }
    }
    case 'reset':
      return { status: 'idle', errors: {} }
  }
}
