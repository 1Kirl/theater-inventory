import {
  ClipboardList, ListChecks, Package, RefreshCw, Theater, Users, type LucideIcon,
} from 'lucide-react'
import { Reveal } from '@/features/landing/ScrollReveal'
import { cn } from '@/lib/utils'

/**
 * The transitional section: scattered information, then one workspace.
 *
 * The arrangement carries the idea on its own — five labelled pieces around a
 * centre that names what holds them. The motion only settles them into it, so a
 * visitor with `prefers-reduced-motion` loses nothing but the movement.
 *
 * Plain DOM and CSS transforms. No canvas, no physics, no scroll listener.
 */

interface Fragment {
  label: string
  icon: LucideIcon
  /** Which direction this piece drifts in from. Defined in `landing.css`. */
  drift: string
  /** Grid placement from `md` up; the mobile order is source order. */
  placement?: string
}

const FRAGMENTS: readonly Fragment[] = [
  { label: 'Equipment', icon: Package, drift: 'drift-a' },
  { label: 'Production requirements', icon: ListChecks, drift: 'drift-b' },
  { label: 'Teams', icon: Users, drift: 'drift-c' },
  {
    label: 'Responsibilities', icon: ClipboardList, drift: 'drift-d',
    placement: 'md:col-start-1 md:row-start-2',
  },
  {
    label: 'Changes', icon: RefreshCw, drift: 'drift-e',
    placement: 'md:col-start-3 md:row-start-2',
  },
]

export function ProblemSection() {
  return (
    <section className="border-border bg-[var(--landing-cream)] border-y py-24 md:py-32">
      <Reveal className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <h2 data-reveal className="landing-h2 mx-auto max-w-5xl text-center">
          The backstage work was connected.
          <br className="hidden sm:inline" /> The information wasn&rsquo;t.
        </h2>

        <p data-reveal className="landing-body reveal-d1 mx-auto mt-6 text-center">
          A production keeps all of this in step at once. Kept in separate places, each piece stops
          answering questions about the others.
        </p>

        <ul className="mt-16 grid gap-3 md:mt-20 md:grid-cols-3 md:items-center md:gap-4">
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
            className="reveal-d5 border-primary/25 bg-[var(--landing-sage)] flex flex-col items-center justify-center gap-2 rounded-2xl border px-4 py-7 text-center md:col-start-2 md:row-start-2"
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
      </Reveal>
    </section>
  )
}
