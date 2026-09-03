import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useRevealGroup } from '@/features/landing/use-reveal-group'

/**
 * The common case: a plain container that reveals what is inside it.
 *
 * Where the group has to be a particular tag — an `<li>` inside an `<ol>` —
 * use `useRevealGroup` directly and spread it onto that element instead.
 */
export function Reveal({
  children,
  className,
  threshold,
}: {
  children: ReactNode
  className?: string
  threshold?: number
}) {
  const group = useRevealGroup(threshold === undefined ? undefined : { threshold })

  return (
    <div {...group} className={cn(className)}>
      {children}
    </div>
  )
}
