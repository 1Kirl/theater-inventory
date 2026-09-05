import {
  ClipboardList, ListChecks, Package, RefreshCw, Theater, Users, type LucideIcon,
} from 'lucide-react'
import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia } from '@/features/landing/landing-media'
import { cn } from '@/lib/utils'

/**
 * Why this exists, and what it is for — told once.
 *
 * This replaces two sections that opened with almost the same sentence. One was
 * headed "The backstage work was connected. The tools weren't." and the other
 * "The backstage work was connected. The information wasn't.", two screens
 * apart, and the paragraph under the first said the same thing about scattered
 * messages and spreadsheets that the lead under the second did. Two roles were
 * being claimed — a personal note and a diagram — but only one idea was being
 * carried, twice.
 *
 * Now the personal voice frames it and the composition demonstrates it: the
 * prose says the work was scattered, and beside it five labelled pieces settle
 * around the one thing that holds them. The first person is kept deliberately.
 * This is the only part of the page that is not about the software, and turning
 * it into product copy would remove the reason it is here.
 *
 * The pieces drift into place with the reveal primitive the page already has —
 * plain DOM and CSS transforms, no scroll listener of its own. The atmosphere
 * behind the page is decorative and independent; nothing here interacts with it.
 */

interface Fragment {
  label: string
  icon: LucideIcon
  /** Which direction this piece drifts in from. Defined in `landing.css`. */
  drift: string
  /** Grid placement from `sm` up; the mobile order is source order. */
  placement?: string
}

const FRAGMENTS: readonly Fragment[] = [
  { label: 'Equipment', icon: Package, drift: 'drift-a' },
  { label: 'Production requirements', icon: ListChecks, drift: 'drift-b' },
  { label: 'Teams', icon: Users, drift: 'drift-c' },
  {
    label: 'Responsibilities', icon: ClipboardList, drift: 'drift-d',
    placement: 'sm:col-start-1 sm:row-start-2',
  },
  {
    label: 'Changes', icon: RefreshCw, drift: 'drift-e',
    placement: 'sm:col-start-3 sm:row-start-2',
  },
]

export function NarrativeSection() {
  return (
    <section
      id="about"
      className="bg-[color-mix(in_oklab,var(--landing-ground)_var(--landing-veil-open),transparent)] py-24 md:py-32"
    >
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <p data-reveal className="landing-eyebrow">
          01 / Why I built this
        </p>

        <h2 data-reveal className="landing-h2 reveal-d1 mt-6 max-w-5xl">
          The backstage work was connected.
          <br className="hidden sm:inline" /> The tools weren&rsquo;t.
        </h2>

        <div className="mt-14 grid gap-12 md:mt-16 lg:grid-cols-12 lg:items-start lg:gap-14">
          <div className="lg:col-span-5">
            <div data-reveal className="reveal-d2 space-y-5">
              <p className="landing-body">
                During theatre productions I kept noticing that the hardest work happens behind the
                stage: equipment, production requirements, team responsibilities, and last-minute
                changes, scattered across messages, spreadsheets, and conversations.
              </p>
              <p className="landing-body">
                A production keeps all of it in step at once. Kept in separate places, each piece
                stops answering questions about the others.
              </p>
              <p className="landing-body">
                I wanted to find out whether one workspace could hold it instead. That question
                became this project.
              </p>
            </div>

            <div data-reveal className="reveal-frame reveal-d3 mt-10 max-w-sm">
              <MediaPlaceholder media={landingMedia.story} />
            </div>
          </div>

          {/* The scattered pieces, and the thing that holds them. The list is
              the argument the prose beside it is making, which is why the two
              share a row rather than following one another. */}
          <ul className="grid gap-3 sm:grid-cols-3 sm:items-center sm:gap-4 lg:col-span-6 lg:col-start-7">
            {FRAGMENTS.map((fragment) => (
              <li
                key={fragment.label}
                className={cn(
                  'landing-drift border-border bg-[var(--landing-panel)] flex items-center gap-3 rounded-xl border px-4 py-3.5',
                  fragment.drift,
                  fragment.placement,
                )}
              >
                <fragment.icon className="text-primary size-4 shrink-0" aria-hidden="true" />
                <span className="text-sm font-medium">{fragment.label}</span>
              </li>
            ))}

            <li
              data-reveal
              className="reveal-d5 border-primary/25 bg-[var(--landing-sage)] flex flex-col items-center justify-center gap-2 rounded-2xl border px-4 py-7 text-center sm:col-start-2 sm:row-start-2"
            >
              <span
                className="bg-[var(--landing-panel)] text-primary border-border flex size-9 items-center justify-center rounded-xl border"
                aria-hidden="true"
              >
                <Theater className="size-4" />
              </span>
              <span className="text-sm font-semibold">One workspace</span>
              <span className="text-muted-foreground text-xs">
                Where every piece can see the others
              </span>
            </li>
          </ul>
        </div>
      </Reveal>
    </section>
  )
}
