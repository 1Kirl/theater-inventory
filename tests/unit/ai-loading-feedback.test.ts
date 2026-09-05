import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What the two AI features do while they are waiting.
 *
 * A generation can run for half a minute, and for that whole time the page has
 * to keep saying so. The failure QA reported was not a broken request — it was
 * a screen that looked identical whether the model was working, had failed
 * silently, or had never been asked. Somebody who cannot tell reloads, and the
 * answer is thrown away.
 *
 * There are exactly two places that call a model. Both are asserted here rather
 * than one, because the second is the one that gets forgotten.
 */

const src = path.resolve(import.meta.dirname, '../../src')
const read = (file: string) => readFileSync(path.join(src, file), 'utf8')

const FLOWS = [
  {
    name: 'Requirement Generator',
    file: 'features/ai/RequirementGeneratorDialog.tsx',
    busy: 'generating',
    label: 'AI_GENERATING',
  },
  {
    name: 'Smart Search',
    file: 'features/ai/SmartSearchPanel.tsx',
    busy: 'running',
    label: 'AI_SEARCHING',
  },
] as const

describe.each(FLOWS)('$name', ({ file, busy, label }) => {
  const text = read(file)

  it('shows a waiting state while the model is working', () => {
    expect(text).toContain('AiThinking')
    expect(text).toContain(`{${busy} ? <AiThinking label={${label}} /> : null}`)
  })

  it('clears the waiting state whatever happens, including a failure', () => {
    // In `finally`, not at the end of the happy path: an error that left this
    // set would strand the spinner on screen forever, which is a worse lie than
    // showing nothing at all.
    const body = text.slice(text.indexOf('try {'))
    const finallyBlock = body.slice(body.indexOf('} finally {'), body.indexOf('} finally {') + 120)

    expect(finallyBlock).toMatch(/set(Generating|Running)\(false\)/)
  })

  it('refuses a second request while one is in flight', () => {
    // The disabled button is the affordance, not the guard. A second click
    // that arrives before React re-renders, or an example chip that calls the
    // function directly, both reach this line instead.
    expect(text).toMatch(new RegExp(`if \\(${busy}[^)]*\\) return`))
  })

  it('reports a failure rather than leaving the wait to speak for it', () => {
    // The feature is passed so the message can say what this feature's fallback
    // actually is — Smart Search still has its filters, the generator has
    // nothing — which is why the argument is asserted rather than just the call.
    expect(text).toMatch(/setError\(aiFailureMessage\(caught, '[a-z-]+'\)\)/)
  })
})

describe('the two waits are one component', () => {
  it('is shared, so neither flow can drift into its own wording', () => {
    const component = read('features/ai/AiThinking.tsx')

    expect(component).toContain('animate-spin')
    // Announced without stealing focus.
    expect(component).toContain('role="status"')
    expect(component).toContain('export const AI_GENERATING')
    expect(component).toContain('export const AI_SEARCHING')
  })

  it('says the wait is expected, so a long one does not read as a hang', () => {
    const component = read('features/ai/AiThinking.tsx')

    for (const constant of ['AI_GENERATING', 'AI_SEARCHING']) {
      const line = component.slice(component.indexOf(`export const ${constant}`))
      expect(line.slice(0, line.indexOf('\n')), constant).toMatch(/take (up to )?a (minute|moment)/)
    }
  })

  it('covers every place the application asks a model anything', () => {
    // If a third AI feature is added, this is what says its wait is missing.
    const consumers = ['requirement-generator-service', 'smart-search-service']

    for (const service of consumers) {
      const users = FLOWS.filter(({ file }) => read(file).includes(service))
      expect(users.length, service).toBe(1)
    }
  })
})

describe('the wait is bounded by the SDK, not by a second clock', () => {
  it('passes an explicit timeout to getGenerativeModel', () => {
    // Without this the SDK applies its own default of 180 seconds, which is a
    // batch-job ceiling on an interactive button press. `RequestOptions.timeout`
    // drives the SDK's internal AbortController and actually cancels the fetch;
    // a `Promise.race` of our own would leave the request running and merely
    // stop listening for it, which is how a "cancelled" request goes on costing
    // quota.
    const source = read('features/ai/ai-client.ts')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(code).toContain('{ timeout: AI_REQUEST_TIMEOUT_MS }')
    expect(code).not.toContain('Promise.race')
    expect(code).not.toContain('setTimeout')
  })

  it('measures how long the request ran, for the development diagnostic', () => {
    // The one thing the error object never carries, and the one that separates
    // a refusal from a request that ran out the clock.
    for (const { file } of FLOWS) {
      const text = read(file)
      expect(text, file).toContain('const startedAt = Date.now()')
      expect(text, file).toMatch(/reportAiFailure\(caught, '[a-z-]+', Date\.now\(\) - startedAt\)/)
    }
  })
})

describe('the model and the thinking level are chosen deliberately', () => {
  it('still uses gemini-3.5-flash', () => {
    // Pinned so a model swap is a decision somebody makes on purpose. The
    // latency work changed how much the model thinks, not which model it is.
    expect(read('features/ai/ai-client.ts')).toContain("const AI_MODEL = 'gemini-3.5-flash'")
  })

  it('asks for minimal thinking in Smart Search and nowhere else', () => {
    // The two features share one client, so the setting is per request. If it
    // ever moves into the shared config, the generator loses the deliberation
    // that is most of what it is for — silently, and only visibly as worse
    // drafts.
    expect(read('features/ai/smart-search-service.ts'))
      .toContain('thinkingLevel: ThinkingLevel.MINIMAL')
    expect(read('features/ai/requirement-generator-service.ts'))
      .not.toContain('thinkingLevel')
    // The client may name the *type*; what it must not do is pick a value.
    const clientCode = read('features/ai/ai-client.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(clientCode).not.toContain('ThinkingLevel.MINIMAL')
  })

  it('never sets a thinking budget alongside a level', () => {
    // The SDK documents that a model errors when both are given. Comments are
    // stripped first: the client's own note explains why the budget is left
    // alone, and matching that would be matching prose.
    for (const file of [
      'features/ai/ai-client.ts',
      'features/ai/smart-search-service.ts',
      'features/ai/requirement-generator-service.ts',
    ]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, file).not.toContain('thinkingBudget')
    }
  })
})
