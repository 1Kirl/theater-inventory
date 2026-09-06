import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { paths } from '@/routes/paths'

/**
 * Where the landing page can actually send somebody.
 *
 * It is the only page in the application a signed-out visitor sees, so its
 * links are the entire funnel. Two ways to get that wrong are invisible in
 * review and invisible in a screenshot:
 *
 * 1. Offering only one door. The page shipped with three calls to action and
 *    all three went to the log-in form, which is a dead end for anybody who
 *    does not have an account yet.
 * 2. Linking into the application. Every route but `/login` and `/signup` is
 *    behind `AuthGuard`, so a link to one bounces the visitor to the log-in
 *    form — the page would appear to work and would quietly lose people.
 *
 * The suite has no DOM, so this reads the sources. That is the same approach
 * its neighbour `landing-boundaries.test.ts` takes, and why this lives here
 * rather than beside the components: reading the filesystem needs the Node
 * types, which the application project deliberately does not have.
 */

const landing = path.resolve(import.meta.dirname, '../../src/features/landing')

const sources = new Map<string, string>(
  readdirSync(landing)
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => [entry, readFileSync(path.join(landing, entry), 'utf8')]),
)

/** The `paths` members a file routes to, via `<Link to={paths.x}>`. */
function routeTargets(source: string): string[] {
  return [...source.matchAll(/<Link\s+to=\{paths\.(\w+)\}/g)].map((match) => match[1] ?? '')
}

function targetsIn(file: string): string[] {
  return routeTargets(sources.get(file) ?? '')
}

const everyTarget = [...sources.values()].flatMap(routeTargets)

describe('the landing page offers both doors', () => {
  it('links to sign-up and to log-in', () => {
    expect(everyTarget).toContain('signUp')
    expect(everyTarget).toContain('logIn')
  })

  it('offers signing up in the header, the opening, and the close', () => {
    // Somebody without an account decides at one of these three moments. The
    // close matters most and is the easiest to leave out, because the section
    // reads as finished with a single button in it.
    for (const file of ['LandingHeader.tsx', 'HeroSection.tsx', 'FinalCtaSection.tsx']) {
      expect(targetsIn(file), file).toContain('signUp')
    }
  })

  it('keeps logging in reachable from the sticky header and the close', () => {
    // The header is sticky, which is what lets the opening spend its second
    // button on reading further instead of on signing in.
    for (const file of ['LandingHeader.tsx', 'FinalCtaSection.tsx']) {
      expect(targetsIn(file), file).toContain('logIn')
    }
    expect(sources.get('LandingHeader.tsx')).toContain('sticky')
  })
})

describe('the landing page links nowhere a signed-out visitor cannot go', () => {
  it('routes only to the two public screens', () => {
    // `AuthGuard` covers everything else. A link to `/inventory` here would
    // send a visitor to the log-in form with no explanation.
    expect([...new Set(everyTarget)].sort()).toEqual(['logIn', 'signUp'])
  })

  it('names its destinations through `paths`, never as literals', () => {
    // A hard-coded '/login' survives a rename of the path and starts serving
    // the not-found page instead.
    for (const [file, source] of sources) {
      const literals = [...source.matchAll(/<Link\s+to="([^"]*)"/g)].map((match) => match[1])
      expect(literals, file).toEqual([])
    }
  })

  it('agrees with the paths it imports', () => {
    expect(paths.logIn).toBe('/login')
    expect(paths.signUp).toBe('/signup')
  })
})

describe('in-page navigation goes somewhere', () => {
  it('anchors only to sections that exist', () => {
    // The header's section menu and the opening's "Explore the project" are
    // fragment links. A renamed `id` breaks them silently: the click does
    // nothing at all, with no error anywhere.
    const ids = new Set(
      [...sources.values()].flatMap((source) =>
        [...source.matchAll(/(?:^|\s)id="([^"]+)"/g)].map((match) => match[1]),
      ),
    )

    const anchors = [...sources.values()].flatMap((source) =>
      [...source.matchAll(/href="#([^"]+)"/g)].map((match) => match[1] ?? ''),
    )

    expect(anchors.length).toBeGreaterThan(0)
    for (const anchor of anchors) {
      expect(ids, `#${anchor} has no section`).toContain(anchor)
    }
  })
})
