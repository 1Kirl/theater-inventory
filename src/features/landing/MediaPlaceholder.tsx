import { ImageIcon, MonitorIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LandingMedia } from '@/features/landing/landing-media'

/**
 * A frame that holds either the real image or a placeholder for it.
 *
 * The frame keeps its aspect ratio either way, so dropping a screenshot into
 * `landing-media.ts` changes what is inside the box and nothing about the page
 * around it. The placeholder is styled as part of the design rather than as a
 * development artefact — it says what belongs there, and it will not look
 * broken if a screenshot is still missing when somebody visits.
 */
export function MediaPlaceholder({
  media,
  variant = 'photo',
  className,
  frameClassName,
}: {
  media: LandingMedia
  /** `browser` adds a restrained window bar above the image. */
  variant?: 'browser' | 'photo'
  className?: string
  frameClassName?: string
}) {
  const Icon = variant === 'browser' ? MonitorIcon : ImageIcon

  return (
    <figure
      className={cn(
        'border-border bg-[var(--landing-panel)] overflow-hidden rounded-2xl border',
        'shadow-[0_1px_2px_oklch(0.3_0.02_160/5%),0_18px_44px_-28px_oklch(0.3_0.02_160/22%)]',
        className,
      )}
    >
      {variant === 'browser' ? (
        <div
          className="border-border bg-[var(--landing-cream)] flex h-8 items-center gap-1.5 border-b px-3.5"
          aria-hidden="true"
        >
          <span className="bg-muted-foreground/25 size-2 rounded-full" />
          <span className="bg-muted-foreground/25 size-2 rounded-full" />
          <span className="bg-muted-foreground/25 size-2 rounded-full" />
        </div>
      ) : null}

      <div
        className={cn('relative w-full', frameClassName)}
        style={{ aspectRatio: media.aspect }}
      >
        {media.src === undefined ? (
          <div className="bg-[var(--landing-sage)] absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-5 text-center">
            <span
              className="bg-[var(--landing-panel)] text-primary border-border flex size-9 items-center justify-center rounded-xl border"
              aria-hidden="true"
            >
              <Icon className="size-4" />
            </span>
            <span className="landing-eyebrow text-foreground/70">{media.label}</span>
            <span className="text-muted-foreground max-w-[26ch] text-xs leading-relaxed">
              {media.description}
            </span>
          </div>
        ) : (
          <img
            src={media.src}
            alt={media.alt}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </div>
    </figure>
  )
}
