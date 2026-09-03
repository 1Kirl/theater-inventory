import { Reveal } from '@/features/landing/ScrollReveal'
import { cn } from '@/lib/utils'

/**
 * How the project was actually built.
 *
 * Every stage below is evidenced by something in this repository — the
 * specification documents, the decision log, the order of the commits, and the
 * test suites. Nothing is claimed that the repository does not show: there was
 * no user research, no interview programme, no usability study and no external
 * adoption, so none of those appear here.
 */

interface Stage {
  number: string
  title: string
  body: string
}

const STAGES: readonly Stage[] = [
  {
    number: '01',
    title: 'Problem',
    body: 'The failure being solved was written down before any code: a spreadsheet one person maintains, repairs nobody can see, and planning done from memory.',
  },
  {
    number: '02',
    title: 'Information architecture',
    body: 'Pages, contents, and user flows were specified in a workbook and a set of documents, which the implementation is still checked against.',
  },
  {
    number: '03',
    title: 'Decisions',
    body: 'Data shapes, the permission model, and the platform constraint were settled in a written decision log — including the decisions that later replaced earlier ones.',
  },
  {
    number: '04',
    title: 'Development',
    body: 'One bounded feature at a time: authentication, organizations, inventory, maintenance, productions, the two AI features, then the dashboard.',
  },
  {
    number: '05',
    title: 'Testing and iteration',
    body: '1,948 unit tests over the domain logic, plus Security Rules tested against the Firebase emulator. Real defects were still found by hand afterwards, and fixing them is part of the history.',
  },
]

/** Stagger classes from `landing.css`; the first stage leads. */
const DELAYS = ['', 'reveal-d1', 'reveal-d2', 'reveal-d3', 'reveal-d4'] as const

export function BuildJourneySection() {
  return (
    <section
      id="build-journey"
      className="border-border bg-[var(--landing-cream)] border-y py-24 md:py-36"
    >
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <p data-reveal className="landing-eyebrow">
          04 / Build journey
        </p>
        <h2 data-reveal className="landing-h2 reveal-d1 mt-6">
          Built through iteration.
        </h2>
        <p data-reveal className="landing-body reveal-d2 mt-7">
          The interface was the last part. Most of the work was deciding what the system had to be
          true about before anything could be drawn.
        </p>
      </Reveal>

      <Reveal className="mx-auto mt-16 w-full max-w-7xl px-5 sm:px-8 md:mt-20">
        <ol className="grid gap-10 lg:grid-cols-5 lg:gap-6">
          {STAGES.map((stage, index) => (
            <li
              key={stage.number}
              data-reveal
              className={cn('border-border border-t pt-6', DELAYS[index])}
            >
              <div className="flex items-center gap-2.5">
                <span className="bg-primary/70 size-1.5 rounded-full" aria-hidden="true" />
                <span className="text-primary/80 text-xs font-semibold tracking-[0.18em]">
                  {stage.number}
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold tracking-tight">{stage.title}</h3>
              <p className="text-muted-foreground mt-2.5 text-sm leading-relaxed">{stage.body}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  )
}
