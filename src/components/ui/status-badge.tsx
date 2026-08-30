import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { StatusTone } from '@/domain/status-tone'

/**
 * The one place a status tone becomes pixels.
 *
 * Each tone is a single CSS token defined per theme; the soft fill and the
 * border are that same colour at low opacity, so a tone is one variable rather
 * than three and the light and dark palettes cannot drift apart. Dark mode gets
 * a slightly stronger fill because a 12% wash disappears against a dark card.
 *
 * Two shapes, because the application has two different kinds of state to show.
 * `pill` is where something is in its life. `dot` is what condition it is in —
 * same colour vocabulary, visibly different object, so "Available" and
 * "Excellent" are never mistaken for the same claim about the same axis.
 */
const statusBadgeVariants = cva(
  'inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-4xl border px-2 py-0.5 '
  + 'text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        positive: 'text-tone-positive border-tone-positive/25 bg-tone-positive/10 dark:bg-tone-positive/18',
        ready: 'text-tone-ready border-tone-ready/25 bg-tone-ready/10 dark:bg-tone-ready/18',
        info: 'text-tone-info border-tone-info/25 bg-tone-info/10 dark:bg-tone-info/18',
        planned: 'text-tone-planned border-tone-planned/25 bg-tone-planned/10 dark:bg-tone-planned/18',
        warning: 'text-tone-warning border-tone-warning/25 bg-tone-warning/10 dark:bg-tone-warning/18',
        caution: 'text-tone-caution border-tone-caution/25 bg-tone-caution/10 dark:bg-tone-caution/18',
        danger: 'text-tone-danger border-tone-danger/25 bg-tone-danger/10 dark:bg-tone-danger/18',
        neutral: 'text-tone-neutral border-tone-neutral/25 bg-tone-neutral/10 dark:bg-tone-neutral/18',
      },
      shape: {
        pill: '',
        // Reads as an annotation rather than a state: the colour is carried by a
        // dot, and the chip itself stays out of the way.
        dot: 'border-border bg-transparent text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral', shape: 'pill' },
  },
)

interface Props
  extends Omit<React.ComponentProps<'span'>, 'children'>,
  VariantProps<typeof statusBadgeVariants> {
  tone: StatusTone
  /** The words. Never omitted — the colour is a second channel, not the only one. */
  label: string
}

export function StatusBadge({ tone, shape = 'pill', label, className, ...props }: Props) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(statusBadgeVariants({ tone, shape }), className)}
      {...props}
    >
      {shape === 'dot' ? (
        <span
          className="bg-current size-1.5 shrink-0 rounded-full"
          style={{ color: `var(--tone-${tone})` }}
          aria-hidden="true"
        />
      ) : null}
      {label}
    </span>
  )
}

export { statusBadgeVariants }
