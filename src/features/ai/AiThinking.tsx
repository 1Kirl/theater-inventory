import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * What the application says while the model is working.
 *
 * A generation can take half a minute. For that whole time the only signal used
 * to be a disabled button with a changed label, which is not enough to tell
 * "still working" apart from "stuck" or "silently failed" — and a person who
 * cannot tell reloads the page, which throws the request away.
 *
 * So it is a visible, stationary statement rather than a busier button: it
 * occupies the space the answer will appear in, and it says the wait is
 * expected instead of leaving that to be inferred.
 *
 * Both AI features render this one component, so the two waits look the same.
 *
 * `role="status"` announces it to a screen reader without stealing focus; the
 * spinner itself is decorative and is not announced twice.
 */
export function AiThinking({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        'border-border bg-surface-sunken text-muted-foreground flex items-center gap-2.5',
        'rounded-lg border border-dashed px-3 py-2.5 text-sm',
        className,
      )}
    >
      <Loader2 className="text-primary size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/** The two waits, worded once so they cannot drift apart. */
export const AI_GENERATING = 'AI is generating suggestions… this can take up to a minute.'
export const AI_SEARCHING = 'AI is searching your inventory… this can take a moment.'
