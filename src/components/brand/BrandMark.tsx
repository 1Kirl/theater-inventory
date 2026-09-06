import { cn } from '@/lib/utils'

/**
 * The product mark: a proscenium.
 *
 * Two uprights joined by a rounded top, standing on a stage line that runs
 * wider than the arch itself. It is drawn from what the rest of this product
 * already looks like rather than beside it — the page's whole visual language
 * is hairlines with things sitting on them (the workflow spine, the build
 * timeline, the rule under every heading), and its surfaces are rounded
 * rectangles. This is the same two ideas at icon scale.
 *
 * What it deliberately is not: a pair of masks. That is the first thing every
 * theatre logo reaches for, it is illustrative rather than geometric, and it
 * collapses into a smudge below about twenty pixels. An arch on a line keeps a
 * silhouette nobody confuses with a menu, a padlock, or a folder at 16px.
 *
 * Geometry matches lucide's: a 24 unit grid, 2 unit strokes, round caps. That
 * is not decoration — this sits beside lucide icons in the header and the auth
 * screen, and a mark with a different stroke weight beside them reads as a
 * borrowed asset. It inherits `currentColor`, so it works in the accent green,
 * in the footer's muted grey, and in pure monochrome without a second file.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-4', className)}
    >
      {/* The stage line, running three units past the opening on each side. */}
      <path d="M3 19h18" />
      {/* The proscenium: two uprights and a half-round head. Wide enough
          relative to the line that it reads as an opening rather than a dome. */}
      <path d="M6 19V12a6 6 0 0 1 12 0v7" />
    </svg>
  )
}
