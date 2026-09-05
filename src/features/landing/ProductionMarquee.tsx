import { ImageIcon } from 'lucide-react'
import { landingMedia, type LandingMedia } from '@/features/landing/landing-media'

/**
 * The film strip at the foot of the page.
 *
 * Two identical groups scroll as one track; when the track has travelled half
 * its width the second group is exactly where the first began, so the loop has
 * no seam. The arithmetic is in `landing.css` — each group carries a trailing
 * gap equal to its internal one, which is what makes the two halves exactly
 * equal rather than approximately equal.
 *
 * Under `prefers-reduced-motion` the animation stops and the strip becomes an
 * ordinary horizontally scrollable row. It is focusable so that stopping is not
 * the same as losing access to it — and focusing it also pauses the motion for
 * anyone driving the page from the keyboard.
 */

/** One frame. Height is fixed by the strip; the aspect ratio sets the width. */
function Photo({ photo }: { photo: LandingMedia }) {
  return (
    <div
      className="border-border bg-[var(--landing-sage)] h-full shrink-0 overflow-hidden rounded-xl border"
      style={{ aspectRatio: photo.aspect }}
    >
      {photo.src === undefined ? (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 px-3 text-center">
          <ImageIcon className="text-primary/70 size-3.5" aria-hidden="true" />
          <span className="landing-eyebrow text-[0.6rem] leading-tight">{photo.label}</span>
        </div>
      ) : (
        <img
          src={photo.src}
          alt={photo.alt}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      )}
    </div>
  )
}

/**
 * One half of a row.
 *
 * `offset` rotates the same photographs so the two rows are not the same strip
 * twice; it reuses the existing entries rather than needing any of its own.
 */
function PhotoGroup({ hidden, offset }: { hidden: boolean; offset: number }) {
  const photos = landingMedia.productionPhotos
  const ordered = [...photos.slice(offset), ...photos.slice(0, offset)]

  return (
    <div className="landing-marquee__group" aria-hidden={hidden ? true : undefined}>
      {ordered.map((photo) => (
        <Photo key={photo.id} photo={photo} />
      ))}
    </div>
  )
}

/** One row. The seam copy is the same group again, announced to nobody. */
function MarqueeRow({ variant, offset }: { variant: 'front' | 'back'; offset: number }) {
  return (
    <div className={`landing-marquee__track landing-marquee__track--${variant}`}>
      <PhotoGroup hidden={false} offset={offset} />
      <PhotoGroup hidden offset={offset} />
    </div>
  )
}

export function ProductionMarquee() {
  return (
    <section
      aria-label="Photographs from productions"
      className="border-border bg-[color-mix(in_oklab,var(--landing-ground)_var(--landing-veil-muted),transparent)] border-t py-14 md:py-20"
    >
      <p className="landing-eyebrow mx-auto mb-8 w-full max-w-7xl px-5 sm:px-8">
        From the productions
      </p>

      <div
        className="landing-marquee"
        tabIndex={0}
        role="group"
        aria-label="Production photographs, scrollable"
      >
        {/* Two rows on a wide screen, travelling in opposite directions at
            slightly different speeds. The second sits a little further back —
            smaller and paler — so the pair reads as depth rather than as two
            unrelated strips. A phone gets the front row only; two of these
            over a physics atmosphere is more than a small screen wants. */}
        <MarqueeRow variant="front" offset={0} />
        <MarqueeRow variant="back" offset={4} />
      </div>
    </section>
  )
}
