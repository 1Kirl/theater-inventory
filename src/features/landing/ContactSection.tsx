import { useId, useMemo, useReducer, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Reveal } from '@/features/landing/ScrollReveal'
import {
  CONTACT_LIMITS, configuredContactTransport, contactReducer, createContactSender,
  initialContactState, type ContactDraft, type ContactField, type ContactTransport,
} from '@/features/landing/contact-message'
import { cn } from '@/lib/utils'

/**
 * A way to write to the project, at the foot of the page.
 *
 * The form is honest about what it can do. Delivery goes through the one
 * transport configured at build time (see `contact-message.ts`); with none
 * configured the fields are disabled and the section says so, rather than
 * accepting a message it has nowhere to send. It shows "sent" only after the
 * provider has answered that it accepted the message.
 *
 * Nothing a visitor types is logged, kept, or sent anywhere except the
 * configured provider.
 */

const EMPTY: ContactDraft = { name: '', title: '', message: '', website: '' }

/** Resolved once, at build time; `null` when no target is configured. */
const CONFIGURED_TRANSPORT = configuredContactTransport()

export function ContactSection({
  transport = CONFIGURED_TRANSPORT,
}: {
  /** For tests. The page always uses the configured one. */
  transport?: ContactTransport | null
}) {
  const [state, dispatch] = useReducer(contactReducer, transport !== null, initialContactState)
  const send = useMemo(
    () => (transport === null ? null : createContactSender(transport, dispatch)),
    [transport],
  )
  const [draft, setDraft] = useState<ContactDraft>(EMPTY)
  const id = useId()
  const fieldId = (field: string) => `${id}-${field}`

  const unavailable = state.status === 'unavailable'
  const submitting = state.status === 'submitting'

  function update(field: keyof ContactDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    if (field !== 'website') dispatch({ type: 'edit', field })
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (send === null) return

    const outcome = await send(draft)
    if (outcome.kind === 'sent') setDraft(EMPTY)
    if (outcome.kind === 'invalid') {
      const first = (Object.keys(outcome.errors) as ContactField[])[0]
      if (first) document.getElementById(fieldId(first))?.focus()
    }
  }

  const errorId = (field: ContactField) => `${fieldId(field)}-error`
  const described = (field: ContactField, extra?: string) =>
    [state.errors[field] ? errorId(field) : null, extra].filter(Boolean).join(' ') || undefined

  return (
    <section
      id="contact"
      aria-labelledby={`${id}-heading`}
      className="border-border bg-[color-mix(in_oklab,var(--landing-cream)_var(--landing-veil-mid),transparent)] border-t py-24 md:py-32"
    >
      <Reveal className="mx-auto grid w-full max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-14">
        <div className="lg:col-span-5">
          <p data-reveal className="landing-eyebrow">
            Contact
          </p>
          <h2 id={`${id}-heading`} data-reveal className="landing-h2 reveal-d1 mt-6">
            Write to the project.
          </h2>
          <p data-reveal className="landing-body reveal-d2 mt-7 max-w-md">
            Questions about how it works, what it was built for, or using it with your own crew.
          </p>
        </div>

        <div data-reveal className="reveal-d3 lg:col-span-7">
          {state.status === 'sent' ? (
            <div
              role="status"
              className="border-primary/25 bg-[var(--landing-panel)] rounded-2xl border p-6 sm:p-8"
            >
              <p className="text-base font-semibold">Message sent.</p>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Thank you for writing — it has been delivered. This form does not collect a reply
                address, so include one in your message if you would like an answer.
              </p>
              <Button
                type="button"
                variant="outline"
                className="landing-lift mt-6"
                onClick={() => dispatch({ type: 'reset' })}
              >
                Send another message
              </Button>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={onSubmit}
              aria-busy={submitting}
              className="border-border bg-[var(--landing-panel)] rounded-2xl border p-5 sm:p-8"
            >
              {unavailable ? (
                <p
                  id={`${id}-unavailable`}
                  className="border-border bg-[var(--landing-sage)] mb-6 rounded-xl border px-4 py-3 text-sm leading-relaxed"
                >
                  The contact form is not connected yet, so it cannot send messages. It will be
                  switched on once message delivery has been set up.
                </p>
              ) : null}

              <fieldset
                disabled={unavailable || submitting}
                aria-describedby={unavailable ? `${id}-unavailable` : undefined}
                className="grid min-w-0 gap-5 sm:grid-cols-2"
              >
                <legend className="sr-only">Your message</legend>

                <Field
                  id={fieldId('name')}
                  label="Name"
                  error={state.errors.name}
                  errorId={errorId('name')}
                >
                  <Input
                    id={fieldId('name')}
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    maxLength={CONTACT_LIMITS.name}
                    value={draft.name}
                    onChange={(event) => update('name', event.target.value)}
                    aria-invalid={state.errors.name ? true : undefined}
                    aria-describedby={described('name')}
                    className="h-11 bg-[var(--landing-panel)] px-3.5"
                  />
                </Field>

                <Field
                  id={fieldId('title')}
                  label="Title"
                  error={state.errors.title}
                  errorId={errorId('title')}
                >
                  <Input
                    id={fieldId('title')}
                    name="title"
                    type="text"
                    required
                    maxLength={CONTACT_LIMITS.title}
                    value={draft.title}
                    onChange={(event) => update('title', event.target.value)}
                    aria-invalid={state.errors.title ? true : undefined}
                    aria-describedby={described('title')}
                    className="h-11 bg-[var(--landing-panel)] px-3.5"
                  />
                </Field>

                <Field
                  id={fieldId('message')}
                  label="Message"
                  error={state.errors.message}
                  errorId={errorId('message')}
                  className="sm:col-span-2"
                >
                  <textarea
                    id={fieldId('message')}
                    name="message"
                    required
                    rows={6}
                    maxLength={CONTACT_LIMITS.message}
                    value={draft.message}
                    onChange={(event) => update('message', event.target.value)}
                    aria-invalid={state.errors.message ? true : undefined}
                    aria-describedby={described('message', `${fieldId('message')}-count`)}
                    className={cn(TEXTAREA_CLASS, 'min-h-36 resize-y')}
                  />
                  <p
                    id={`${fieldId('message')}-count`}
                    className="text-muted-foreground mt-1.5 text-right text-xs tabular-nums"
                  >
                    {draft.message.length} / {CONTACT_LIMITS.message}
                  </p>
                </Field>

                {/* The honeypot: out of sight, out of the tab order, and out of
                    the accessibility tree. People leave it empty. */}
                <div aria-hidden="true" className="sr-only">
                  <label>
                    Website
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={draft.website}
                      onChange={(event) => update('website', event.target.value)}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                  <Button
                    type="submit"
                    size="lg"
                    className="landing-lift h-11 px-6"
                    aria-disabled={unavailable || submitting}
                  >
                    {submitting ? 'Sending…' : 'Submit'}
                  </Button>

                  {state.status === 'failed' ? (
                    <p role="alert" className="text-destructive text-sm">
                      {state.failure === 'activation'
                        ? 'Message delivery is waiting to be activated, so nothing was delivered. Please try again later.'
                        : 'The message could not be sent. Nothing was delivered — please try again.'}
                    </p>
                  ) : null}
                </div>
              </fieldset>
            </form>
          )}
        </div>
      </Reveal>
    </section>
  )
}

/** The textarea, matched to the application's `Input` so the two read as one set. */
const TEXTAREA_CLASS = cn(
  'border-input block w-full min-w-0 rounded-lg border bg-[var(--landing-panel)] px-3.5 py-2.5',
  'text-base outline-none transition-colors md:text-sm',
  'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:ring-3',
)

function Field({
  id, label, error, errorId, className, children,
}: {
  id: string
  label: string
  error: string | undefined
  errorId: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={errorId} className="text-destructive mt-1.5 text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
