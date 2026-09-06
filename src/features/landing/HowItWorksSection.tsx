import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { useRevealGroup } from '@/features/landing/use-reveal-group'
import { useScrollProgress } from '@/features/landing/use-scroll-progress'
import { landingMedia, type LandingMedia } from '@/features/landing/landing-media'

/**
 * The workflow, drawn as one line down the page.
 *
 * The section above says what the product contains. This one says how a term's
 * work moves through it, and the difference has to be visible and not only
 * stated: the Product Showcase is a sticky stage where five screens stack in
 * depth, so repeating that structure here would make the two read as one long
 * effect. The motif here is the line instead — a hairline running through four
 * markers that fills with the product's green as the reader descends. Nothing
 * pins, nothing overlaps, and the same markup serves a phone.
 *
 * The assignment step is not filler. Joining with a code grants nothing on
 * purpose — a new member is Unassigned until an Admin gives them teams and
 * module permissions — so leaving it out would describe a product that opens
 * further on joining than this one does.
 *
 * Emphasis is deliberately carried by the marker, the step number, and the
 * screenshot, never by the prose: dimming a paragraph a reader has not reached
 * yet buys a little drama at the cost of contrast on text that is on screen and
 * legible. Every step reads at full strength the whole way down.
 */

interface Step {
  number: string
  title: string
  body: string
}

/*
 * Steps 03 and 04 describe the actions, not the mechanisms. The mechanisms —
 * counted versus individually tracked units, QR labels, shortage computed from
 * live availability, the action's owner and due date — are what the Product
 * Showcase directly above already explains, and saying them twice was most of
 * why this section felt like a second feature list.
 */
const STEPS: readonly Step[] = [
  {
    number: '01',
    title: 'Create or join an organization',
    body: 'One person creates the organization and becomes its Admin. Everyone else joins with the code they hand out.',
  },
  {
    number: '02',
    title: 'Get teams and permissions',
    body: 'Joining grants nothing by itself. An Admin puts you on a crew and decides which modules you can view or edit.',
  },
  {
    number: '03',
    title: 'Record what the program owns',
    body: 'One pass through the storage room puts the shelves on record. After that it is upkeep — log repairs as they happen, and nobody counts a shelf to answer a question.',
  },
  {
    number: '04',
    title: 'Plan a production against it',
    body: 'Draw up what the show needs, and the gaps come back as work with a name on it and a date.',
  },
]

function StepRow({ step, index, media }: { step: Step; index: number; media: LandingMedia }) {
  // The list item is the reveal group, so the markup stays a real ordered list.
  const group = useRevealGroup({ threshold: 0.05 })

  return (
    <li {...group} className="workflow-step" style={{ '--step': index } as React.CSSProperties}>
      {/* The node and the connector below it, as one column spanning the whole
          row. Built this way rather than as pseudo-elements so the dot and the
          line are centred by the same flex box: their alignment is structural
          and cannot drift. The line reaches past the row's own bottom edge to
          the next step's node, so the connector between two steps is one
          element rather than two halves to keep in step. */}
      <span className="workflow-marker" aria-hidden="true">
        <span className="workflow-marker__dot" />
        <span className="workflow-marker__line">
          <span className="workflow-marker__fill" />
        </span>
      </span>

      <div className="workflow-step__copy">
        <p data-reveal className="workflow-step__number">
          {step.number}
        </p>
        <h3 data-reveal className="landing-h3 reveal-d1 mt-3">
          {step.title}
        </h3>
        <p data-reveal className="landing-body reveal-d2 mt-4">
          {step.body}
        </p>
      </div>

      {/* Two elements, because two systems own this frame and neither may
          overwrite the other: the outer one is the entrance the observer
          fires once, the inner one is the standing emphasis that follows the
          reading head up and down the page for as long as the section is on
          screen. */}
      <div data-reveal className="reveal-frame reveal-d3 workflow-step__media">
        <div className="workflow-step__frame">
          <MediaPlaceholder media={media} variant="browser" />
        </div>
      </div>
    </li>
  )
}

export function HowItWorksSection() {
  // One measurement for the whole section. The list is the track, so progress
  // is zero before the first step and one after the last.
  const trackRef = useScrollProgress()

  return (
    <section id="how-it-works" className="workflow bg-[color-mix(in_oklab,var(--landing-ground)_var(--landing-veil-muted),transparent)] py-20 md:py-28">
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <p data-reveal className="landing-eyebrow">
          03 / How it works
        </p>
        <h2 data-reveal className="landing-h2 reveal-d1 mt-6">
          From setup to showtime.
        </h2>
        <p data-reveal className="landing-lead reveal-d2 mt-7 max-w-xl text-balance">
          Four steps from an empty account to a production plan a crew can work from.
        </p>
      </Reveal>

      <ol ref={trackRef} className="workflow-track mx-auto mt-14 w-full max-w-7xl px-5 sm:px-8">
        {STEPS.map((step, index) => (
          <StepRow
            key={step.number}
            step={step}
            index={index}
            media={landingMedia.howItWorks[index] ?? landingMedia.workspace}
          />
        ))}
      </ol>
    </section>
  )
}
