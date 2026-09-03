import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { useRevealGroup } from '@/features/landing/use-reveal-group'
import { landingMedia, type LandingMedia } from '@/features/landing/landing-media'

/**
 * The whole workflow in four steps, checked against what the application does.
 *
 * The assignment step is not filler. Joining with a code grants nothing on
 * purpose — a new member is Unassigned until an Admin gives them teams and
 * module permissions — so leaving it out would describe a product that opens
 * further on joining than this one does.
 *
 * Desktop uses ordinary CSS `position: sticky`: each step's text pins inside
 * its own row while its screenshot travels past, then releases when the next
 * step arrives. There is no scroll listener, no scroll hijacking, and no custom
 * physics — the browser's own scrolling does all of it. Below `lg` the sticky
 * is simply not applied and the section becomes the plain vertical sequence a
 * phone wants: step, screenshot, step, screenshot.
 */

interface Step {
  number: string
  headline: string
  body: string
}

const STEPS: readonly Step[] = [
  {
    number: '01',
    headline: 'Create or join an organization',
    body: 'Create one and you are its Admin. Join an existing one with the code your director or stage manager gives you.',
  },
  {
    number: '02',
    headline: 'Get teams and permissions',
    body: 'An Admin puts people on crews and decides which modules they can view or edit. Joining on its own grants nothing until they do.',
  },
  {
    number: '03',
    headline: 'Record what the program owns',
    body: 'Add equipment as a counted quantity or as individually tracked units, log repairs as they happen, and print labels for the shelves.',
  },
  {
    number: '04',
    headline: 'Plan a production against it',
    body: 'List what a show needs. Shortages come from live availability, and each one becomes an action with an owner and a due date.',
  },
]

function StepRow({ step, media }: { step: Step; media: LandingMedia }) {
  // The list item is the reveal group, so the markup stays a real ordered list.
  const group = useRevealGroup({ threshold: 0.05 })

  return (
    // The row is taller than the text column on purpose: the difference is
    // exactly how far the text stays pinned while its screenshot travels.
    <li
      {...group}
      className="lg:grid lg:min-h-[96vh] lg:grid-cols-12 lg:items-start lg:gap-6 lg:py-16"
    >
      <div className="lg:sticky lg:top-28 lg:col-span-4 lg:col-start-1 lg:self-start">
        <span data-reveal className="text-primary/70 block text-sm font-semibold tracking-[0.18em]">
          {step.number}
        </span>
        <h3 data-reveal className="landing-h3 reveal-d1 mt-4">
          {step.headline}
        </h3>
        <p data-reveal className="landing-body reveal-d2 mt-5">
          {step.body}
        </p>
      </div>

      <div
        data-reveal
        className="reveal-frame reveal-d3 mt-8 lg:col-span-7 lg:col-start-6 lg:mt-0"
      >
        <MediaPlaceholder media={media} variant="browser" />
      </div>
    </li>
  )
}

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-[var(--landing-ground)] py-24 md:py-36">
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <p data-reveal className="landing-eyebrow">
          03 / How it works
        </p>
        <h2 data-reveal className="landing-h2 reveal-d1 mt-6">
          From setup to showtime.
        </h2>
      </Reveal>

      <ol className="mx-auto mt-16 w-full max-w-7xl space-y-20 px-5 sm:px-8 md:mt-24 lg:space-y-0">
        {STEPS.map((step, index) => (
          <StepRow
            key={step.number}
            step={step}
            media={landingMedia.howItWorks[index] ?? landingMedia.workspace}
          />
        ))}
      </ol>
    </section>
  )
}
