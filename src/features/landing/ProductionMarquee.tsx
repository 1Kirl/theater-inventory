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

function PhotoGroup({ hidden }: { hidden: boolean }) {
  return (
    <div className="landing-marquee__group" aria-hidden={hidden ? true : undefined}>
      {landingMedia.productionPhotos.map((photo) => (
        <Photo key={photo.id} photo={photo} />
      ))}
    </div>
  )
}

export function ProductionMarquee() {
  return (
    <section
      aria-label="Photographs from productions"
      className="border-border bg-[var(--landing-ground)] border-t py-14 md:py-20"
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
        <div className="landing-marquee__track h-[132px] md:h-[200px]">
          <PhotoGroup hidden={false} />
          {/* The seam copy. Announced to nobody. */}
          <PhotoGroup hidden />
        </div>
      </div>
    </section>
  )
}
