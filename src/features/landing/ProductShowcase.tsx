import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia, type FeatureKey } from '@/features/landing/landing-media'
import { useScrollProgress } from '@/features/landing/use-scroll-progress'
import { cn } from '@/lib/utils'

/**
 * The product, told once.
 *
 * This replaces two sections that were telling the same story twice: one
 * introducing "a single workspace" over a dashboard screenshot, and another
 * presenting four module screenshots as four independent full-width rows. The
 * second undid the first — a reader was shown a unified product and then four
 * separate ones.
 *
 * Now the dashboard opens the sequence and the four modules emerge from it, so
 * the claim the copy makes is the thing the composition demonstrates.
 *
 * Every claim below was checked against the code rather than the plan: bulk and
 * serialized inventory with derived availability, QR labels and the camera
 * scanner, maintenance records with due dates and cost, production requirements
 * whose shortage is computed by the domain layer, the action list, and the two
 * AI features wired into the inventory and production pages. Nothing that is
 * documented but unbuilt appears here.
 *
 * One DOM serves both layouts. Each stage is a self-contained item holding its
 * own copy and its own screen, which on a phone is simply a vertical sequence
 * of copy-then-image. Only at desktop widths does the stylesheet lift those
 * items onto a shared sticky stage and drive them from scroll progress. There
 * is no second markup path to keep in step, and nothing on a phone depends on a
 * scroll position to become readable.
 */

interface Stage {
  /** `null` is the opening overview, which is the dashboard rather than a module. */
  key: FeatureKey | null
  index: string
  label: string
  headline: string
  body: string
}

const STAGES: readonly Stage[] = [
  {
    key: null,
    index: '00',
    label: 'The workspace',
    headline: 'One place the whole production lives in.',
    // Carries the two claims the old summary grid made that the module stages
    // below do not: what needs attention, and who is responsible. The other
    // two — what a production needs, what is available — are the productions
    // and inventory stages, so repeating them here would be the duplication
    // this section exists to remove.
    body: 'Inventory, repairs, production requirements, and the calendar are kept together and '
      + 'scoped to one organization, so the numbers on the dashboard are read from records rather '
      + 'than remembered. Shortages, overdue repairs, and upcoming dates are summarized on one '
      + 'screen, and every record carries the team and the person responsible for it.',
  },
  {
    key: 'inventory',
    index: '01',
    label: 'Inventory and equipment',
    headline: 'Know what you actually have.',
    body: 'Things that are interchangeable are counted; things where it matters which one — a '
      + 'particular microphone, with its own repair history — are tracked as individual units. '
      + 'What is available is calculated from what is on hand, in use, and out for repair, so '
      + 'nobody maintains the number by hand. Either kind can be given a printed QR label that a '
      + 'phone camera opens.',
  },
  {
    key: 'maintenance',
    index: '02',
    label: 'Maintenance and repair',
    headline: 'Repairs stop being invisible.',
    body: 'A repair record says what went out, who has it, when it is due back, and what it cost. '
      + 'The available quantity follows from it automatically, so a light sitting in a shop is no '
      + 'longer counted as ready. Anything past its return date is marked overdue wherever it '
      + 'appears.',
  },
  {
    key: 'productions',
    index: '03',
    label: 'Productions and requirements',
    headline: 'Plan a show against what is really on the shelf.',
    body: 'A production lists what it needs, and each requirement is matched against live '
      + 'inventory with the shortage worked out by the application rather than by a person. Every '
      + 'real shortage becomes one action — buy, rent, build, or repair — carrying an owner, a due '
      + 'date, and an optional cost estimate that adds up to the production total.',
  },
  {
    key: 'ai',
    index: '04',
    label: 'The two AI features',
    headline: 'Ask the inventory a question.',
    body: 'Smart Search answers plain-language questions about the organization’s own equipment '
      + 'and shows the real records behind the answer. The requirement generator drafts a '
      + 'production’s equipment list against the inventory that actually exists. Both are '
      + 'suggestions: a person reviews and approves before anything is saved, and every '
      + 'calculation stays with the application.',
  },
]

function mediaFor(stage: Stage) {
  return stage.key === null ? landingMedia.workspace : landingMedia.features[stage.key]
}

export function ProductShowcase() {
  // One measurement for the whole sequence. Every screen and every line of copy
  // reads the same `--scroll-progress` from this element; nothing here observes
  // scrolling on its own.
  const trackRef = useScrollProgress()

  return (
    <section id="features" className="showcase">
      <Reveal className="mx-auto w-full max-w-7xl px-5 pt-24 sm:px-8 md:pt-36">
        {/* Not "The workspace": that is the name of the first stage below, and
            an eyebrow repeating the heading repeating the first stage reads as
            a stutter. This one names the section among its neighbours. */}
        <p data-reveal className="landing-eyebrow">
          02 / The product
        </p>
        <h2 data-reveal className="landing-h2 reveal-d1 mt-6 max-w-4xl">
          One workspace for the production
          <br className="hidden sm:inline" /> behind the production.
        </h2>
      </Reveal>

      <div ref={trackRef} className="showcase-track">
        <div className="showcase-stage">
          {/*
            * The index rail. On desktop it says where in the sequence the
            * reader is; on a phone it is hidden, because the sequence is the
            * document order and a reader is already in it.
            */}
          <ol className="showcase-rail" aria-hidden="true">
            {STAGES.map((stage, index) => (
              <li
                key={stage.index}
                className="showcase-rail__item"
                style={{ '--stage': index } as React.CSSProperties}
              >
                <span className="showcase-rail__index">{stage.index}</span>
                <span className="showcase-rail__label">{stage.label}</span>
              </li>
            ))}
          </ol>

          <ul className="showcase-items">
            {STAGES.map((stage, index) => (
              <li
                key={stage.index}
                className={cn('showcase-item', index === 0 && 'showcase-item--overview')}
                style={{ '--stage': index } as React.CSSProperties}
              >
                <div className="showcase-item__copy">
                  <p className="landing-eyebrow">
                    <span className="showcase-item__index">{stage.index}</span>
                    {stage.label}
                  </p>
                  <h3 className="landing-h3 mt-4">{stage.headline}</h3>
                  <p className="landing-body mt-5">{stage.body}</p>
                </div>

                <figure className="showcase-item__media">
                  <MediaPlaceholder media={mediaFor(stage)} variant="browser" />
                </figure>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
