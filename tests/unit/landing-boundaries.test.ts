import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The three promises the landing page makes that no rendered test would catch.
 *
 * It is a presentation layer bolted onto an application whose authorization is
 * enforced in Firestore Security Rules. That makes two of its failure modes
 * quiet ones: styling that escapes the page and reaches the authenticated
 * interface, and a "have they seen it yet" flag that decouples what renders at
 * `/` from whether the visitor is actually signed in.
 *
 * The third is the visitor who has asked their operating system to stop moving
 * things. That preference is a media query, and the project already forbids
 * reading it in JavaScript, so honouring it has to happen in the stylesheet.
 */

const src = path.resolve(import.meta.dirname, '../../src')
const landing = path.join(src, 'features/landing')

const read = (file: string) => readFileSync(file, 'utf8')
const css = read(path.join(landing, 'landing.css'))
const guards = read(path.join(src, 'routes/guards.tsx'))
const signOut = read(path.join(src, 'features/auth/SignOutButton.tsx'))

function landingSources(): string[] {
  return readdirSync(landing)
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
    .map((entry) => path.join(landing, entry))
}

/**
 * Every selector in a stylesheet, one per comma-separated part.
 *
 * Written by hand rather than with a regular expression over the whole file: a
 * pattern that reaches across newlines silently swallows the comment block
 * above a rule and reports it as a selector, which is how a test like this
 * ends up asserting the wrong thing about the right file.
 */
function selectorsOf(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const preludes: string[] = []
  let start = 0

  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index]
    if (character !== '{' && character !== '}') continue

    const chunk = withoutComments.slice(start, index).trim()
    if (character === '{' && chunk.length > 0) preludes.push(chunk)
    start = index + 1
  }

  return preludes
    // At-rules carry their own prelude — `@media (…)`, `@keyframes name` — and
    // keyframe steps are not selectors at all.
    .filter((prelude) => !prelude.startsWith('@') && !/^(from|to|\d+%)$/.test(prelude))
    .flatMap((prelude) => prelude.split(',').map((part) => part.trim()))
    .filter((part) => part.length > 0)
}

describe('landing styling cannot reach the application', () => {
  it('scopes every rule under the class only this page renders', () => {
    // A bare `section {…}` or `h2 {…}` here would restyle the dashboard the
    // moment the chunk loaded, and would stay loaded for the rest of the
    // session. Every selector has to name the landing root; the one rule that
    // cannot is `scroll-behavior`, which belongs to the document and is
    // conditioned on the landing page being in it instead.
    const escaping = selectorsOf(css).filter(
      (selector) => !selector.startsWith('.landing-root') && selector !== 'html:has(.landing-root)',
    )

    expect(escaping).toEqual([])
  })

  it('drives smooth scrolling from the landing page being present, not from the app', () => {
    // `scroll-behavior` belongs to the document, so it cannot be scoped to a
    // wrapper. Conditioning it on the page's own class is what keeps an
    // animated jump out of application navigation.
    expect(css).toContain('html:has(.landing-root)')
    expect(css).toContain('scroll-behavior: smooth')
  })

  it('borrows the application palette instead of inventing a second one', () => {
    // Hard-coded colour here would not follow the light and dark themes the
    // product already ships, which is the same rule the charts live under.
    const colourLiterals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)]
    expect(colourLiterals.map((match) => match[0])).toEqual([])
  })
})

describe('reduced motion is honoured in CSS, because it cannot be read in JS', () => {
  it('switches off reveals, drifts, and the photo strip', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

    expect(reduce).not.toBe('')
    expect(reduce).toContain('[data-reveal]')
    expect(reduce).toContain('.landing-drift')
    expect(reduce).toContain('.landing-marquee__track')
    // Motionless must still mean reachable: the strip becomes a row the
    // visitor scrolls themselves rather than one that has stopped.
    expect(reduce).toContain('overflow-x: auto')
  })

  it('reads the preference nowhere in JavaScript', () => {
    // `matchMedia` is banned across this codebase by the theme boundaries, and
    // a landing page is exactly where somebody would reach for it.
    for (const file of landingSources()) {
      expect(read(file), path.basename(file)).not.toContain('matchMedia')
    }
  })
})

describe('what renders at / depends on authentication and nothing else', () => {
  const gate = guards.slice(guards.indexOf('export function LandingGate'))
  const body = gate.slice(0, gate.indexOf('\n}\n'))

  it('is gated on the root path, so the modules stay behind AuthGuard', () => {
    expect(body).toContain('useMatch(paths.landing)')
  })

  it('waits for Firebase to restore the session before choosing', () => {
    // Deciding early is the flash: the landing page for one frame, then the
    // dashboard replacing it.
    expect(body).toContain('loading')
    expect(body).toContain('LoadingScreen')
  })

  it('remembers nothing about the visitor', () => {
    // A stored "has seen the landing page" flag would survive signing out and
    // would disagree with auth state sooner or later. There is no such flag.
    expect(body).not.toContain('localStorage')
    expect(body).not.toContain('sessionStorage')

    for (const file of landingSources()) {
      expect(read(file), path.basename(file)).not.toContain('localStorage')
    }
  })

  it('sends somebody who signs out back to the landing page', () => {
    expect(signOut).toContain('navigate(paths.landing, { replace: true })')
    expect(signOut).not.toContain('navigate(paths.logIn')
  })
})
