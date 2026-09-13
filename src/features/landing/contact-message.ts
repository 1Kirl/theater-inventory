/**
 * The contact form's one boundary with the outside world.
 *
 * This project runs on Firebase's Spark plan with no server code, so it has no
 * way to send email by itself — and an SMTP login or a provider's private key
 * in the page would be readable by every visitor. Delivery goes through
 * FormSubmit instead: a form-to-email service that needs no account and no
 * key, only a target in its AJAX URL, `https://formsubmit.co/ajax/<target>`.
 * The visitor stays on the page; nothing redirects.
 *
 * THE TARGET, in order of preference, fixed at build time:
 *
 *   VITE_CONTACT_FORM_ID           the random string FormSubmit issues once the
 *                                  recipient has activated the form. Preferred:
 *                                  it hides the address from the page.
 *   VITE_CONTACT_RECIPIENT_EMAIL   the recipient's address. Needed to activate
 *                                  the form in the first place.
 *   neither                        the form renders disabled and says so.
 *
 * Neither value is a secret. Anything a Vite build reads ships in the bundle,
 * so an address configured here is readable by every visitor. That is why the
 * form ID wins — and with an ID set, `vite.config.ts` defines the address away
 * before compiling, so it stays out of the bundle even if it is still set.
 *
 * Activation: FormSubmit does not deliver to a target until the recipient has
 * confirmed it. The first submission to a new address sends them an "Activate
 * Form" email instead of the message, and the provider answers that the form
 * needs activation. That answer is reported as a failure — nothing was
 * delivered — with wording of its own, so whoever runs the first submission
 * can tell the two apart.
 *
 * Success is shown only when FormSubmit answers 2xx with `success` true. Any
 * other answer, a network failure or a timeout is reported as a failure.
 *
 * Abuse is limited here only as far as a page can limit it: bounded lengths, a
 * hidden honeypot field, and one request in flight at a time. A filled
 * honeypot stops the request before it is made, so FormSubmit's own `_honey`
 * field would always arrive empty and is not sent. Rate limiting and spam
 * filtering belong to the provider, the only party that sees every submission.
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

/**
 * Why a send failed. `activation` is FormSubmit saying the recipient has not
 * confirmed the form yet; everything else — a refusal, a network failure, a
 * timeout — is `delivery`. Neither carries the provider's text or the message.
 */
export type ContactFailure = 'activation' | 'delivery'

export class ContactDeliveryError extends Error {
  readonly reason: ContactFailure

  constructor(reason: ContactFailure) {
    super(reason === 'activation' ? 'Contact form is not activated' : 'Contact delivery failed')
    this.name = 'ContactDeliveryError'
    this.reason = reason
  }
}

const TIMEOUT_MS = 15_000

const FORMSUBMIT_AJAX = 'https://formsubmit.co/ajax/'

/*
 * What a target may look like. Deliberately narrower than everything an email
 * address may legally contain: nothing that would need escaping in a URL path
 * (`/`, `?`, `#`, `%`, whitespace) can get through, so the target is placed in
 * the URL as it is and can never point the request somewhere else.
 */
const EMAIL_TARGET = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/
const FORM_ID_TARGET = /^[A-Za-z0-9_-]{8,128}$/

/**
 * The FormSubmit AJAX URL for a configured target — a recipient address or an
 * issued form ID — or null when the value is missing or malformed. Pure.
 */
export function formSubmitEndpoint(target: string | undefined): string | null {
  const value = target?.trim() ?? ''
  if (value.length > 254) return null
  if (!EMAIL_TARGET.test(value) && !FORM_ID_TARGET.test(value)) return null
  return FORMSUBMIT_AJAX + value
}

/**
 * What FormSubmit receives. The three fields under readable names, because
 * its table template prints the keys as the row labels; the title as the
 * subject, on one line; nothing else. No reply address is invented — the form
 * does not ask for one.
 */
export function formSubmitPayload(message: ContactMessage): Record<string, string> {
  return {
    Name: message.name,
    Title: message.title,
    Message: message.message,
    _subject: `Theater Inventory Tracker contact: ${message.title.replace(/\s+/g, ' ')}`,
    _template: 'table',
  }
}

/** FormSubmit reports `success` as the string "true"; a boolean is accepted too. */
function accepted(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const success = (body as { success?: unknown }).success
  return success === true || success === 'true'
}

function needsActivation(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const message = (body as { message?: unknown }).message
  return typeof message === 'string' && /activat/i.test(message)
}

export function formSubmitTransport(
  endpoint: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ContactTransport {
  return async (message) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    let body: unknown = null
    let ok = false
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(formSubmitPayload(message)),
        signal: controller.signal,
      })
      ok = response.ok
      body = await response.json().catch(() => null)
    } catch {
      // Offline, refused by CORS, or timed out. Nothing about the visitor's
      // message is written anywhere.
      throw new ContactDeliveryError('delivery')
    } finally {
      clearTimeout(timer)
    }

    if (ok && accepted(body)) return
    throw new ContactDeliveryError(needsActivation(body) ? 'activation' : 'delivery')
  }
}

/**
 * The transport the build was configured with, or null when there is none.
 *
 * Both variables are read by name, here and nowhere else, so that the define
 * in `vite.config.ts` — which blanks the address whenever an ID is set — is
 * the only thing deciding whether the address reaches the bundle.
 */
export function configuredContactTransport(
  target: string | undefined =
    import.meta.env.VITE_CONTACT_FORM_ID || import.meta.env.VITE_CONTACT_RECIPIENT_EMAIL,
): ContactTransport | null {
  const endpoint = formSubmitEndpoint(target)
  return endpoint === null ? null : formSubmitTransport(endpoint)
}

/*
 * The form's states, as a reducer, so the rules that matter — no success
 * without a delivery, errors that clear as they are fixed — can be checked
 * without rendering anything.
 */

export type ContactStatus = 'unavailable' | 'idle' | 'submitting' | 'sent' | 'failed'

export interface ContactState {
  readonly status: ContactStatus
  readonly errors: ContactErrors
  /** Set only while `status` is `failed`. */
  readonly failure: ContactFailure | null
}

export type ContactAction =
  | { readonly type: 'submit' }
  | { readonly type: 'invalid'; readonly errors: ContactErrors }
  | { readonly type: 'delivered' }
  | { readonly type: 'rejected'; readonly reason: ContactFailure }
  | { readonly type: 'edit'; readonly field: ContactField }
  | { readonly type: 'reset' }

export function initialContactState(available: boolean): ContactState {
  return { status: available ? 'idle' : 'unavailable', errors: {}, failure: null }
}

export function contactReducer(state: ContactState, action: ContactAction): ContactState {
  // With nowhere to send, nothing moves the form out of `unavailable`.
  if (state.status === 'unavailable') return state

  switch (action.type) {
    case 'submit':
      // A second press while one is in flight does nothing.
      return state.status === 'submitting' ? state : { status: 'submitting', errors: {}, failure: null }
    case 'invalid':
      return { status: 'idle', errors: action.errors, failure: null }
    case 'delivered':
      return state.status === 'submitting' ? { status: 'sent', errors: {}, failure: null } : state
    case 'rejected':
      return state.status === 'submitting'
        ? { status: 'failed', errors: {}, failure: action.reason }
        : state
    case 'edit': {
      if (!(action.field in state.errors)) return state
      const errors = { ...state.errors }
      delete errors[action.field]
      return { ...state, errors }
    }
    case 'reset':
      return { status: 'idle', errors: {}, failure: null }
  }
}

export type SendOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'invalid'; readonly errors: ContactErrors }
  /** The honeypot was filled. Reported to the page as a failure; nothing sent. */
  | { readonly kind: 'blocked' }
  /** A send was already in flight, so this press did nothing. */
  | { readonly kind: 'busy' }

/**
 * One submission, start to finish: validate, send through the transport, and
 * move the form's state to match what actually happened.
 *
 * The in-flight flag lives here rather than in the reducer. Two clicks inside
 * one frame both see the render from before the first, so only a flag that
 * is set synchronously sees the first — and it being here means the rule can
 * be checked without rendering anything.
 */
export function createContactSender(
  transport: ContactTransport,
  dispatch: (action: ContactAction) => void,
): (draft: ContactDraft) => Promise<SendOutcome> {
  let inFlight = false

  return async (draft) => {
    if (inFlight) return { kind: 'busy' }

    const result = validateContactDraft(draft)
    if (!result.ok) {
      if (result.spam) {
        // A person never sees the honeypot, so never takes this branch.
        dispatch({ type: 'submit' })
        dispatch({ type: 'rejected', reason: 'delivery' })
        return { kind: 'blocked' }
      }
      dispatch({ type: 'invalid', errors: result.errors })
      return { kind: 'invalid', errors: result.errors }
    }

    inFlight = true
    dispatch({ type: 'submit' })
    try {
      await transport(result.value)
      dispatch({ type: 'delivered' })
      return { kind: 'sent' }
    } catch (error) {
      const reason = error instanceof ContactDeliveryError ? error.reason : 'delivery'
      dispatch({ type: 'rejected', reason })
      return { kind: 'failed' }
    } finally {
      inFlight = false
    }
  }
}
