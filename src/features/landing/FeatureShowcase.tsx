import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia, type FeatureKey } from '@/features/landing/landing-media'
import { cn } from '@/lib/utils'

/**
 * Four workflows, each given a full section.
 *
 * Every claim below was checked against the code rather than the plan: bulk and
 * serialized inventory with derived availability, QR labels and the camera
 * scanner, maintenance records with due dates and cost, production requirements
 * whose shortage is computed by the domain layer, the action list, and the two
 * AI features that are wired into the inventory and production pages. Nothing
 * that is documented but unbuilt appears here.
 *
 * The text comes first in the document for every row and the columns are placed
 * explicitly, so the reading order stays text-then-image while the layout
 * alternates. On a phone the whole thing is one column in that same order.
 */

interface Feature {
  key: FeatureKey
  label: string
  headline: string
  body: string
}

const FEATURES: readonly Feature[] = [
  {
    key: 'inventory',
    label: 'Inventory and equipment',
    headline: 'Know what you actually have.',
    body: 'Things that are interchangeable are counted; things where it matters which one — a particular microphone, with its own repair history — are tracked as individual units. What is available is calculated from what is on hand, in use, and out for repair, so nobody maintains the number by hand. Either kind can be given a printed QR label that a phone camera opens.',
  },
  {
    key: 'maintenance',
    label: 'Maintenance and repair',
    headline: 'Repairs stop being invisible.',
    body: 'A repair record says what went out, who has it, when it is due back, and what it cost. The available quantity follows from it automatically, so a light sitting in a shop is no longer counted as ready. Anything past its return date is marked overdue wherever it appears.',
  },
  {
    key: 'productions',
    label: 'Productions and requirements',
    headline: 'Plan a show against what is really on the shelf.',
    body: 'A production lists what it needs, and each requirement is matched against live inventory with the shortage worked out by the application rather than by a person. Every real shortage becomes one action — buy, rent, build, or repair — carrying an owner, a due date, and an optional cost estimate that adds up to the production total.',
  },
  {
    key: 'ai',
    label: 'The two AI features',
    headline: 'Ask the inventory a question.',
    body: 'Smart Search answers plain-language questions about the organization’s own equipment and shows the real records behind the answer. The requirement generator drafts a production’s equipment list against the inventory that actually exists. Both are suggestions: a person reviews and approves before anything is saved, and every calculation stays with the application.',
  },
]

function FeatureRow({ feature, index }: { feature: Feature; index: number }) {
  const mediaFirst = index % 2 === 1
  // Text on the right rises in from the right; text on the left simply rises.
  const textDirection = mediaFirst ? 'reveal-right' : ''

  return (
    <Reveal
      className={cn(
        'py-20 md:py-28',
        mediaFirst ? 'bg-[var(--landing-ground)]' : 'bg-[var(--landing-cream)]',
      )}
    >
      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-12 lg:gap-6">
        <div className={cn('lg:col-span-5', mediaFirst ? 'lg:col-start-8' : 'lg:col-start-1')}>
          {/* Label, then headline, then copy. The direction is the row's, so the
              block reads as one movement even though it arrives in three. */}
          <p data-reveal className={cn('landing-eyebrow', textDirection)}>{feature.label}</p>
          <h3 data-reveal className={cn('landing-h3 reveal-d1 mt-5', textDirection)}>
            {feature.headline}
          </h3>
          <p data-reveal className={cn('landing-body reveal-d2 mt-6', textDirection)}>
            {feature.body}
          </p>
        </div>

        <div
          data-reveal
          className={cn(
            'reveal-frame reveal-d3 lg:col-span-6',
            mediaFirst ? 'reveal-left lg:col-start-1 lg:row-start-1' : 'lg:col-start-7',
          )}
        >
          <MediaPlaceholder media={landingMedia.features[feature.key]} variant="browser" />
        </div>
      </div>
    </Reveal>
  )
}

export function FeatureShowcase() {
  return (
    <section aria-label="What the application does">
      {FEATURES.map((feature, index) => (
        <FeatureRow key={feature.key} feature={feature} index={index} />
      ))}
    </section>
  )
}
