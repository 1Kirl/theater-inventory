import { Reveal } from '@/features/landing/ScrollReveal'
import { fieldLayoutFor, fieldMedia } from '@/features/landing/field-media'
import { cn } from '@/lib/utils'

/**
 * Where the software meets the shop.
 *
 * The sections above describe what the product does. This one is about the
 * setting it was built for, and it is written more plainly on purpose: no
 * feature names, no figures, no quotations. Nothing here claims an outcome the
 * project cannot show — it describes the kind of moment the tool is meant for,
 * and says what would make it a working tool rather than an exercise.
 *
 * Photographs arrive from `field-media.ts`, which picks up whatever
 * `field-01.webp` … `field-05.webp` exist at build time. The section is written
 * to stand on its text alone, so with no photographs it simply has none: no
 * empty frames, no placeholders.
 */

const MOMENTS: readonly { heading: string; body: string }[] = [
  {
    heading: 'Before a build',
    body: 'The crew checks what is actually on the shelf, rather than what somebody remembers being there.',
  },
  {
    heading: 'When something breaks',
    body: 'The repair is logged where it happens, so the next person who reaches for it already knows.',
  },
  {
    heading: 'As the show changes',
    body: 'Requirements and owners move with it, instead of living in last week’s message thread.',
  },
]

/** Stagger classes from `landing.css`; frames arrive in reading order. */
const DELAYS = ['reveal-d1', 'reveal-d2', 'reveal-d3', 'reveal-d4', 'reveal-d5'] as const

export function FieldSection() {
  const { photos, logo } = fieldMedia
  const layout = fieldLayoutFor(photos.length)

  return (
    <section
      id="in-the-field"
      className="bg-[color-mix(in_oklab,var(--landing-ground)_var(--landing-veil-open),transparent)] py-24 md:py-36"
    >
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p data-reveal className="landing-eyebrow">
              05 / In the field
            </p>
            <h2 data-reveal className="landing-h2 reveal-d1 mt-6 max-w-4xl">
              Where the software meets the scene shop.
            </h2>
          </div>

          {/* The school's mark, when there is one: small, and beside the
              heading rather than over the photographs. */}
          {logo ? (
            <img
              data-reveal
              src={logo}
              alt="School logo"
              loading="lazy"
              decoding="async"
              className="reveal-d2 h-12 w-auto shrink-0 object-contain opacity-80 sm:h-14"
            />
          ) : null}
        </div>

        <div className="mt-10 grid gap-10 md:mt-12 lg:grid-cols-12 lg:gap-14">
          <div data-reveal className="reveal-d2 space-y-5 lg:col-span-7">
            <p className="landing-lead">
              A project like this only means something once it leaves the desk. In the field the
              questions are small and constant: which lights are out for repair, how many handheld
              microphones are actually free, who picked up the rigging job.
            </p>
            <p className="landing-body">
              The answers have to be where the crew already is — on a phone in the wings, on a
              laptop by the shop door — and they have to be the same answers for everyone.
            </p>
            <p className="landing-body">
              That is the difference between a development exercise and a working tool. Not what it
              can do in a demonstration, but whether a student crew reaches for it in the middle of
              a build.
            </p>
          </div>

          <ul className="space-y-6 lg:col-span-5">
            {MOMENTS.map((moment, index) => (
              <li
                key={moment.heading}
                data-reveal
                className={cn('border-border border-t pt-5', DELAYS[index + 2])}
              >
                <h3 className="text-base font-semibold tracking-tight">{moment.heading}</h3>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{moment.body}</p>
              </li>
            ))}
          </ul>
        </div>

        {photos.length > 0 ? (
          <ul className={cn('field-grid mt-14 md:mt-20', `field-grid--${layout}`)}>
            {photos.map((photo, index) => (
              <li key={photo.number} className="field-grid__item">
                <div data-reveal className={cn('reveal-frame field-grid__frame', DELAYS[index])}>
                  <img
                    src={photo.src}
                    /*
                     * Described generically, because the file carries no
                     * caption and inventing what a photograph shows would be
                     * worse than saying less.
                     */
                    alt={`Theater production work, photograph ${photo.number}`}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Reveal>
    </section>
  )
}
