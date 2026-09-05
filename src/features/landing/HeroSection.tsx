import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia } from '@/features/landing/landing-media'
import { usePointerDepth } from '@/features/landing/use-pointer-depth'
import { useScrollProgress } from '@/features/landing/use-scroll-progress'
import { paths } from '@/routes/paths'

/**
 * The opening.
 *
 * Everything is in the document from the first paint; the entrance is opacity
 * and transform only, and nothing waits on JavaScript to become readable. Both
 * actions are usable immediately.
 *
 * Unlike every other section, this one is a sequence rather than a group. The
 * eyebrow arrives, the headline lands a line at a time, the copy follows, the
 * buttons settle, and the product appears last on a plane of its own — about a
 * second and a half from first paint to finished. The timings live in
 * `landing.css` beside the rest of the page's motion, so the order is legible
 * in one place instead of scattered across delay classes here.
 *
 * The section is the reference for both depth inputs. Scroll progress moves the
 * layers as the opening leaves, the pointer leans them very slightly toward the
 * cursor, and both are written as a share of the page's one depth budget — so
 * reduced motion switches them off by zeroing that budget, not by knowing this
 * component exists.
 */
export function HeroSection() {
  const trackScroll = useScrollProgress()
  const trackPointer = usePointerDepth()

  // One element feeds both hooks. Stable, so the ref is not detached and
  // reattached on every render.
  const attach = useCallback(
    (node: HTMLElement | null) => {
      trackScroll(node)
      trackPointer(node)
    },
    [trackScroll, trackPointer],
  )

  return (
    <section
      id="top"
      ref={attach}
      className="relative overflow-hidden bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--landing-cream)_var(--landing-veil-mid),transparent),color-mix(in_oklab,var(--landing-ground)_var(--landing-veil-open),transparent)_72%)]"
    >
      {/* Behind everything, and never in the way of a pointer or a screen
          reader. Two soft washes on a slow cycle; desktop only. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span className="hero-blob hero-blob-a" />
        <span className="hero-blob hero-blob-b" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-5 pt-16 pb-20 sm:px-8 sm:pt-24 md:pt-32 md:pb-28">
        <Reveal className="max-w-6xl">
          <p data-reveal className="landing-eyebrow hero-eyebrow">
            High school theater technology
          </p>

          {/* Two spans rather than one heading, so the line break is something
              the entrance can use. They stay inline-block, so where the break
              below is hidden the halves flow as one sentence and wrap normally. */}
          <h1 className="landing-display mt-5">
            <span data-reveal className="hero-line hero-line-1">
              Bring the whole production
            </span>{' '}
            <br className="hidden sm:inline" />
            <span data-reveal className="hero-line hero-line-2">
              into one place.
            </span>
          </h1>

          <p data-reveal className="landing-lead hero-copy mt-7 max-w-2xl">
            A production management workspace designed to help student theatre teams organize the
            work happening behind the stage.
          </p>

          <div data-reveal className="hero-actions mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="landing-lift h-11 px-5 text-[0.95rem]">
              <Link to={paths.signUp}>
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            {/* Reading on is the second action here, not signing in: the header
                is sticky, so Log in is a thumb's reach away for the whole page
                and does not need a third button competing in the opening. */}
            <Button
              asChild
              variant="outline"
              size="lg"
              className="landing-lift h-11 px-5 text-[0.95rem]"
            >
              <a href="#about">
                Explore the project
                <ArrowDown className="size-4" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </Reveal>

        <Reveal className="mt-14 md:mt-20">
          {/* The stage is what gives the product a back. The panels are
              decoration rather than media slots: they hold nothing, and they
              exist so the screenshot sits on a plane in front of something. */}
          <div className="relative mx-auto max-w-6xl pt-12">
            <div className="hero-layer hero-layer-panels absolute inset-x-0 top-12" aria-hidden="true">
              <span data-reveal className="hero-panel hero-panel-back" />
              <span data-reveal className="hero-panel hero-panel-mid" />
            </div>

            <div className="hero-layer hero-layer-screen relative">
              <div data-reveal className="hero-screen">
                <MediaPlaceholder media={landingMedia.hero} variant="browser" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
