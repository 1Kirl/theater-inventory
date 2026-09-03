import { cn } from '@/lib/utils'
import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia } from '@/features/landing/landing-media'

/**
 * The first look at the real application.
 *
 * Each of the four statements below corresponds to something the dashboard
 * actually computes from records — availability, shortages, overdue repairs,
 * and the team a record belongs to. Nothing here describes work that is not
 * built.
 */
/** Stagger classes, defined in `landing.css`. */
const DELAYS = ['reveal-d1', 'reveal-d2', 'reveal-d3', 'reveal-d4'] as const

const ANSWERS: readonly { question: string; detail: string }[] = [
  {
    question: 'What a production needs',
    detail: 'Requirements listed per production and matched against real inventory.',
  },
  {
    question: 'What equipment is available',
    detail: 'Availability calculated from what is on hand, in use, and out for repair.',
  },
  {
    question: 'What needs attention',
    detail: 'Shortages, overdue repairs, and upcoming dates, summarized on one screen.',
  },
  {
    question: 'Who is responsible',
    detail: 'Teams and assignees on the records they own, per organization.',
  },
]

export function WorkspaceSection() {
  return (
    <section id="features" className="bg-[var(--landing-ground)] py-24 md:py-36">
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <p data-reveal className="landing-eyebrow">
          02 / The workspace
        </p>

        <h2 data-reveal className="landing-h2 reveal-d1 mt-6 max-w-5xl">
          One workspace for the production
          <br className="hidden sm:inline" /> behind the production.
        </h2>

        <p data-reveal className="landing-body reveal-d2 mt-7">
          Inventory, repairs, production requirements, and the calendar are kept together and
          scoped to one organization, so the numbers on the dashboard are read from records rather
          than remembered. Nothing that can be worked out is stored twice.
        </p>

        <div data-reveal className="reveal-frame reveal-d3 mt-14 md:mt-20">
          <MediaPlaceholder media={landingMedia.workspace} variant="browser" />
        </div>

        <dl className="mt-14 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {ANSWERS.map((answer, index) => (
            <div
              key={answer.question}
              data-reveal
              className={cn('border-border border-t pt-5', DELAYS[index])}
            >
              <dt className="text-sm font-semibold">{answer.question}</dt>
              <dd className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {answer.detail}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  )
}
