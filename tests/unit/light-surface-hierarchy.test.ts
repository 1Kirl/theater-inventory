import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The light theme's surface and colour contract.
 *
 * Two revisions produced it. The first gave the page a ground distinct from the
 * cards — it had been `oklch(0.994 …)` against a card of `oklch(1 …)`, six
 * thousandths apart, so nothing in the product looked raised. The second took
 * the pastel back off the six headline cards: a whole card of colour behind a
 * number made the dashboard muddy without making anything easier to find, and
 * the colour moved to the three buttons that actually do something.
 *
 * What survived both is the shape worth protecting: a neutral ground, white
 * cards, colour on small things, and none of it reaching dark mode.
 */

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function block(selector: string): string {
  const match = new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`).exec(css)
  if (match?.[1] === undefined) throw new Error(`No ${selector} block in index.css.`)
  return match[1]
}

const LIGHT = block(':root')
const DARK = block('\\.dark')

function oklchOf(source: string, token: string): { l: number; c: number; h: number } | null {
  const match = new RegExp(`${token}:\\s*oklch\\(\\s*([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)`)
    .exec(source)
  if (!match) return null
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) }
}

function valueOf(source: string, token: string): string {
  const match = new RegExp(`${token}:\\s*([^;]+);`).exec(source)
  if (match?.[1] === undefined) throw new Error(`No ${token} in that block.`)
  return match[1].trim()
}

const CHARTS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6']

describe('the page is visibly not a card', () => {
  const background = oklchOf(LIGHT, '--background')
  const card = oklchOf(LIGHT, '--card')

  it('separates the ground from the card by enough to see', () => {
    expect(background).not.toBeNull()
    // The defect was 0.006. Two hundredths is the point where the boundary of a
    // white card stops needing its border to be believed.
    expect(1 - (background as { l: number }).l).toBeGreaterThanOrEqual(0.02)
  })

  it('keeps the ground light rather than turning the app grey', () => {
    expect((background as { l: number }).l).toBeGreaterThan(0.93)
  })

  it('reads as neutral, not as a green page', () => {
    expect((background as { c: number }).c).toBeLessThanOrEqual(0.02)
  })

  it('leaves the card itself white, since there is nowhere brighter to go', () => {
    expect(card === null || card.l === 1).toBe(true)
  })

  it('leaves a muted fill above the ground, so it is a panel and not a hole', () => {
    expect((oklchOf(LIGHT, '--muted') as { l: number }).l)
      .toBeGreaterThan((background as { l: number }).l)
  })
})

/**
 * The revision that mattered: cards carry no colour of their own.
 *
 * Six tinted surfaces existed for one review cycle and were removed. Asserting
 * their absence is not tidiness — it is the product decision, and the tokens
 * would be easy to reintroduce by habit.
 */
describe('the headline cards are neutral', () => {
  it.each(['blue', 'sand', 'peach', 'rose', 'lavender', 'sage'])(
    'defines no --surface-%s card tint',
    (name) => {
      expect(css).not.toContain(`--surface-${name}:`)
    },
  )

  it('keeps only the sunken surface, which empty states still use', () => {
    const surfaces = [...LIGHT.matchAll(/(--surface-[a-z-]+):/g)].map((m) => m[1])
    expect(surfaces).toEqual(['--surface-sunken'])
  })

  it('keeps that one recessed rather than tinted', () => {
    expect((oklchOf(LIGHT, '--surface-sunken') as { c: number }).c).toBeLessThanOrEqual(0.012)
  })
})

describe('colour moved to the actions, and all three share it', () => {
  it('defines one action treatment rather than one per module', () => {
    // They were briefly blue, lavender, and green. Three hues turned a row of
    // three related buttons into three unrelated ones and spent the product's
    // only brand colour distinguishing things nobody needed distinguished.
    const perModule = [...LIGHT.matchAll(/--action-(inventory|productions|calendar)-/g)]
    expect(perModule).toEqual([])
  })

  it('has a fill, a foreground, and a hover', () => {
    for (const part of ['bg', 'fg', 'hover']) {
      expect(() => valueOf(LIGHT, `--action-${part}`)).not.toThrow()
    }
  })

  it('uses the green the product already calls its own', () => {
    const bg = oklchOf(LIGHT, '--action-bg') as { h: number }
    const primary = oklchOf(LIGHT, '--primary') as { h: number }

    expect(Math.abs(bg.h - primary.h)).toBeLessThanOrEqual(10)
  })

  it('pairs a pale fill with a dark foreground', () => {
    const bg = oklchOf(LIGHT, '--action-bg') as { l: number }
    const fg = oklchOf(LIGHT, '--action-fg') as { l: number }

    expect(bg.l).toBeGreaterThan(0.85)
    expect(fg.l).toBeLessThan(0.5)
    // Enough separation to read at small sizes on a small button.
    expect(bg.l - fg.l).toBeGreaterThan(0.4)
  })

  it('darkens on hover rather than changing colour', () => {
    const bg = oklchOf(LIGHT, '--action-bg') as { l: number; h: number }
    const hover = oklchOf(LIGHT, '--action-hover') as { l: number; h: number }

    expect(hover.l).toBeLessThan(bg.l)
    expect(Math.abs(hover.h - bg.h)).toBeLessThanOrEqual(5)
  })

  it('stays calm — an action is tinted, not saturated', () => {
    expect((oklchOf(LIGHT, '--action-bg') as { c: number }).c).toBeLessThanOrEqual(0.07)
  })

  it('styles them in one place, so the three cannot drift apart', () => {
    expect(css).toContain('.quick-action')
    expect(css).not.toContain("data-accent")
  })
})

describe('the light chart palette is pastel', () => {
  const light = CHARTS.map((token) => oklchOf(LIGHT, token) as { l: number; c: number; h: number })

  it('lifted every colour out of the dark, earthy range it was in', () => {
    // The previous set ran 0.575–0.735. Nothing may sit that low again.
    for (const colour of light) expect(colour.l).toBeGreaterThanOrEqual(0.76)
  })

  it('stops short of vanishing against a white card', () => {
    for (const colour of light) {
      expect(colour.l).toBeLessThanOrEqual(0.88)
      expect(colour.c).toBeGreaterThanOrEqual(0.09)
    }
  })

  it('keeps all six tellable apart by hue or by lightness', () => {
    for (let i = 0; i < light.length; i += 1) {
      for (let j = i + 1; j < light.length; j += 1) {
        const a = light[i] as { l: number; h: number }
        const b = light[j] as { l: number; h: number }
        const hueGap = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h))

        expect(hueGap > 25 || Math.abs(a.l - b.l) > 0.03).toBe(true)
      }
    }
  })

  it('keeps "Unusable, on hand" clearly apart from "In Maintenance"', () => {
    // chart-5 and chart-3 respectively — the distinction the product most
    // depends on, and the closest pair on the wheel.
    const unusable = oklchOf(LIGHT, '--chart-5') as { l: number; h: number }
    const maintenance = oklchOf(LIGHT, '--chart-3') as { l: number; h: number }

    expect(Math.abs(unusable.h - maintenance.h)).toBeGreaterThanOrEqual(40)
    expect(Math.abs(unusable.l - maintenance.l)).toBeGreaterThan(0.03)
  })
})

describe('none of it reached dark mode', () => {
  it('leaves the dark chart palette exactly as it was approved', () => {
    expect(CHARTS.map((token) => valueOf(DARK, token))).toEqual([
      'oklch(0.735 0.09 155)',
      'oklch(0.7 0.105 252)',
      'oklch(0.815 0.115 85)',
      'oklch(0.725 0.105 300)',
      'oklch(0.765 0.13 50)',
      'oklch(0.705 0.135 10)',
    ])
  })

  it('leaves the dark ground and card exactly where they were', () => {
    expect(valueOf(DARK, '--background')).toBe('oklch(0.163 0.011 165)')
    expect(valueOf(DARK, '--card')).toBe('oklch(0.213 0.014 166)')
  })

  it('resolves the action to the outline button dark already had', () => {
    expect(valueOf(DARK, '--action-fg')).toBe('var(--foreground)')
    expect(valueOf(DARK, '--action-bg')).toContain('var(--input)')
    expect(valueOf(DARK, '--action-hover')).toContain('var(--input)')
  })

  it('lets no pale light green into a dark action', () => {
    // On a dark ground the light fill would read as lit rather than as brand.
    for (const part of ['bg', 'fg', 'hover']) {
      expect(valueOf(DARK, `--action-${part}`)).not.toContain('oklch(0.9')
    }
  })

  it('adds no fill to a dark empty state', () => {
    expect(valueOf(DARK, '--surface-sunken')).toBe('transparent')
  })

  it('adds no elevation in dark, where the ground already separates surfaces', () => {
    expect(valueOf(DARK, '--card-shadow')).toBe('none')
  })

  it('leaves every dark status tone untouched', () => {
    for (const tone of ['positive', 'ready', 'info', 'planned', 'warning', 'caution', 'danger']) {
      expect(valueOf(DARK, `--tone-${tone}`)).toMatch(/^oklch\(0\.7|^oklch\(0\.8/)
    }
  })
})

describe('elevation stays a hint', () => {
  it('uses opacities low enough that a page of cards does not hover', () => {
    const opacities = [...valueOf(LIGHT, '--card-shadow').matchAll(/([0-9.]+)%\)/g)]
      .map((m) => Number(m[1]))

    expect(opacities.length).toBeGreaterThan(0)
    for (const opacity of opacities) expect(opacity).toBeLessThanOrEqual(8)
  })
})

describe('the printed sheet is unaffected by any of it', () => {
  it('stays white whatever the ground became', () => {
    expect(css).toMatch(/@media print[\s\S]*background:\s*#fff\s*!important/)
  })
})
