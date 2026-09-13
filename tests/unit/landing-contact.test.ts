import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContactSection } from '@/features/landing/ContactSection'
import {
  ContactDeliveryError, configuredContactTransport, contactReducer, createContactSender,
  formSubmitEndpoint, formSubmitPayload, formSubmitTransport, initialContactState,
  type ContactAction, type ContactDraft, type ContactState, type ContactTransport,
} from '@/features/landing/contact-message'

/**
 * Contact delivery through FormSubmit, with the provider mocked throughout.
 *
 * Nothing here reaches the network: every transport is given its own `fetch`,
 * and the unconfigured cases assert that the global one is never called. The
 * addresses are on the reserved `.invalid` domain and the form IDs are made up;
 * neither is anything real.
 */

const ADDRESS = 'owner@example.invalid'
const FORM_ID = 'a1b2c3d4e5f6a7b8c9d0'
const ENDPOINT = `https://formsubmit.co/ajax/${ADDRESS}`

const message = { name: 'Ada', title: 'A question', message: 'Hello there.' }
const draft = (over: Partial<ContactDraft> = {}): ContactDraft => ({ ...message, website: '', ...over })

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ACCEPTED = { success: 'true', message: 'The form was submitted successfully.' }

/** A mock provider, and the request it was sent. */
function provider(answer: () => Promise<Response>) {
  const fetchImpl = vi.fn((_url: string | URL | Request, _init?: RequestInit) => answer())
  const request = (call = 0) => {
    const [url, init] = fetchImpl.mock.calls[call] ?? []
    return { url, init, body: JSON.parse(String(init?.body)) as Record<string, string> }
  }
  return { fetchImpl, request }
}

/** The reducer, driven the way the component drives it. */
function harness(transport: ContactTransport) {
  let state: ContactState = initialContactState(true)
  const dispatch = (action: ContactAction) => { state = contactReducer(state, action) }
  return { send: createContactSender(transport, dispatch), state: () => state }
}

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const render = (transport: ContactTransport | null) =>
  renderToStaticMarkup(createElement(ContactSection, { transport }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Contact — unconfigured', () => {
  it('has no transport without a valid target', () => {
    for (const target of [undefined, '', '   ', 'not an address', 'short', `${ADDRESS}/x`,
      'owner@example', 'https://formsubmit.co/ajax/x', `a?b=${ADDRESS}`, 'a#b@example.invalid']) {
      expect(configuredContactTransport(target), String(target)).toBeNull()
    }
  })

  it('renders the form, disabled, and says why', () => {
    const html = render(null)
    for (const label of ['Name', 'Title', 'Message']) expect(html).toMatch(new RegExp(`<label[^>]*>${label}</label>`))
    expect(html).toContain('>Submit<')
    expect(html).toContain('not connected yet')
    expect(html).toMatch(/<fieldset[^>]*disabled=""/)
  })

  it('never shows success', () => {
    const html = render(null)
    expect(html).not.toContain('Message sent')
    expect(html).not.toContain('role="status"')
  })

  it('makes no request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(ACCEPTED))
    render(null)
    configuredContactTransport(undefined)
    configuredContactTransport('')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('Contact — configuration', () => {
  it('builds the FormSubmit AJAX endpoint from an address or a form ID', () => {
    expect(formSubmitEndpoint(ADDRESS)).toBe(ENDPOINT)
    expect(formSubmitEndpoint(`  ${ADDRESS}  `)).toBe(ENDPOINT)
    expect(formSubmitEndpoint(FORM_ID)).toBe(`https://formsubmit.co/ajax/${FORM_ID}`)
    expect(configuredContactTransport(FORM_ID)).not.toBeNull()
  })

  it('prefers the form ID to the address', () => {
    const code = strip(readFileSync(
      path.resolve(import.meta.dirname, '../../src/features/landing/contact-message.ts'), 'utf8'))
    expect(code).toMatch(
      /import\.meta\.env\.VITE_CONTACT_FORM_ID\s*\|\|\s*import\.meta\.env\.VITE_CONTACT_RECIPIENT_EMAIL/)
    // Read nowhere else, so nothing else can carry the address into the bundle.
    expect(code.match(/VITE_CONTACT_RECIPIENT_EMAIL/g)).toHaveLength(1)
  })

  it('leaves the address out of the build once a form ID is set', () => {
    const config = strip(readFileSync(path.resolve(import.meta.dirname, '../../vite.config.ts'), 'utf8'))
    expect(config).toMatch(
      /env\.VITE_CONTACT_FORM_ID\s*\?\s*\{\s*'import\.meta\.env\.VITE_CONTACT_RECIPIENT_EMAIL': 'undefined' \}/)
    expect(config).toContain('define: contactFormDefine(mode)')
  })

  it('renders an enabled form when a transport is configured', () => {
    const html = render(async () => {})
    expect(html).not.toContain('not connected yet')
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""/)
    expect(html).not.toContain('Message sent')
  })
})

describe('Contact — the FormSubmit request', () => {
  it('posts JSON to the AJAX endpoint, asking for JSON back', async () => {
    const { fetchImpl, request } = provider(async () => json(ACCEPTED))
    await formSubmitTransport(ENDPOINT, fetchImpl)(message)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const { url, init } = request()
    expect(url).toBe(ENDPOINT)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('carries name, title and message, the title as the subject, and nothing else', async () => {
    const { fetchImpl, request } = provider(async () => json(ACCEPTED))
    await formSubmitTransport(ENDPOINT, fetchImpl)(message)

    expect(request().body).toEqual({
      Name: 'Ada',
      Title: 'A question',
      Message: 'Hello there.',
      _subject: 'Theater Inventory Tracker contact: A question',
      _template: 'table',
    })
    // No redirect, no invented reply address.
    for (const key of ['_next', '_replyto', 'email', '_cc', '_autoresponse']) {
      expect(request().body, key).not.toHaveProperty(key)
    }
  })

  it('keeps the subject to one line', () => {
    expect(formSubmitPayload({ ...message, title: 'Line one\r\nLine two' })._subject)
      .toBe('Theater Inventory Tracker contact: Line one Line two')
  })
})

describe('Contact — what the provider says', () => {
  it('resolves only on 2xx with success true', async () => {
    await expect(formSubmitTransport(ENDPOINT, async () => json(ACCEPTED))(message)).resolves.toBeUndefined()
    await expect(formSubmitTransport(ENDPOINT, async () => json({ success: true }))(message)).resolves.toBeUndefined()
  })

  it.each([
    ['a refusal', () => json({ success: 'false', message: 'Something went wrong.' })],
    ['a server error', () => json(ACCEPTED, 500)],
    ['a body that is not JSON', () => new Response('<html>ok</html>', { status: 200 })],
    ['a body with no verdict', () => json({})],
  ])('fails on %s', async (_label, answer) => {
    const failure = formSubmitTransport(ENDPOINT, async () => answer())(message)
    await expect(failure).rejects.toBeInstanceOf(ContactDeliveryError)
    await expect(failure).rejects.toMatchObject({ reason: 'delivery' })
  })

  it('tells a form still waiting for activation apart', async () => {
    const answer = json({ success: 'false', message: 'This form needs Activation. We’ve sent you an email.' })
    await expect(formSubmitTransport(ENDPOINT, async () => answer)(message))
      .rejects.toMatchObject({ reason: 'activation' })
  })

  it('fails on a network error', async () => {
    await expect(formSubmitTransport(ENDPOINT, async () => { throw new TypeError('Failed to fetch') })(message))
      .rejects.toMatchObject({ reason: 'delivery' })
  })

  it('gives up after fifteen seconds', async () => {
    vi.useFakeTimers()
    const hanging = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })
    const failure = formSubmitTransport(ENDPOINT, hanging)(message)
    const settled = expect(failure).rejects.toMatchObject({ reason: 'delivery' })
    await vi.advanceTimersByTimeAsync(15_000)
    await settled
  })
})

describe('Contact — a submission, start to finish', () => {
  it('shows success only after the provider accepts', async () => {
    const { fetchImpl } = provider(async () => json(ACCEPTED))
    const form = harness(formSubmitTransport(ENDPOINT, fetchImpl))

    expect(await form.send(draft())).toEqual({ kind: 'sent' })
    expect(form.state().status).toBe('sent')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('shows failure when the provider refuses', async () => {
    const form = harness(formSubmitTransport(ENDPOINT, async () => json({ success: 'false' })))
    expect(await form.send(draft())).toEqual({ kind: 'failed' })
    expect(form.state()).toMatchObject({ status: 'failed', failure: 'delivery' })
  })

  it('shows failure, not success, while the form awaits activation', async () => {
    const form = harness(formSubmitTransport(ENDPOINT,
      async () => json({ success: 'false', message: 'This form needs Activation.' })))
    await form.send(draft())
    expect(form.state()).toMatchObject({ status: 'failed', failure: 'activation' })
  })

  it('shows failure on a network error', async () => {
    const form = harness(formSubmitTransport(ENDPOINT, async () => { throw new TypeError('offline') }))
    await form.send(draft())
    expect(form.state()).toMatchObject({ status: 'failed', failure: 'delivery' })
  })

  it('sends once, however fast Submit is pressed', async () => {
    let answer: (response: Response) => void = () => {}
    const { fetchImpl } = provider(() => new Promise<Response>((resolve) => { answer = resolve }))
    const form = harness(formSubmitTransport(ENDPOINT, fetchImpl))

    const first = form.send(draft())
    const second = form.send(draft())
    const third = form.send(draft())
    expect(await second).toEqual({ kind: 'busy' })
    expect(await third).toEqual({ kind: 'busy' })
    expect(form.state().status).toBe('submitting')

    answer(json(ACCEPTED))
    expect(await first).toEqual({ kind: 'sent' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // And once it has finished, the next message is free to go.
    const next = form.send(draft())
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    answer(json(ACCEPTED))
    expect(await next).toEqual({ kind: 'sent' })
  })

  it('sends nothing that fails validation', async () => {
    const { fetchImpl } = provider(async () => json(ACCEPTED))
    const form = harness(formSubmitTransport(ENDPOINT, fetchImpl))

    const outcome = await form.send(draft({ name: ' ', message: 'x'.repeat(4001) }))
    expect(outcome.kind).toBe('invalid')
    expect(Object.keys(form.state().errors).sort()).toEqual(['message', 'name'])
    expect(form.state().status).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends nothing when the honeypot is filled, and does not claim success', async () => {
    const { fetchImpl } = provider(async () => json(ACCEPTED))
    const form = harness(formSubmitTransport(ENDPOINT, fetchImpl))

    expect(await form.send(draft({ website: 'http://spam.example' }))).toEqual({ kind: 'blocked' })
    expect(form.state().status).toBe('failed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
