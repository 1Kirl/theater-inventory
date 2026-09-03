import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia } from '@/features/landing/landing-media'
import { paths } from '@/routes/paths'

/**
 * The opening.
 *
 * Everything is in the document from the first paint; the entrance is opacity
 * and transform only, staggered by CSS. Nothing waits on JavaScript to become
 * readable, and the two actions are usable immediately.
 */
export function HeroSection() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-[linear-gradient(to_bottom,var(--landing-cream),var(--landing-ground)_72%)]"
    >
      <div className="mx-auto w-full max-w-7xl px-5 pt-16 pb-20 sm:px-8 sm:pt-24 md:pt-32 md:pb-28">
        <Reveal className="max-w-6xl">
          <p data-reveal className="landing-eyebrow">
            High school theater technology
          </p>

          <h1 data-reveal className="landing-display reveal-d1 mt-5">
            Bring the whole production
            <br className="hidden sm:inline" /> into one place.
          </h1>

          <p data-reveal className="landing-lead reveal-d2 mt-7 max-w-2xl">
            A production management workspace designed to help student theatre teams organize the
            work happening behind the stage.
          </p>

          <div data-reveal className="reveal-d3 mt-9 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="h-11 px-5 text-[0.95rem]">
              <Link to={paths.signUp}>
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            {/* Reading on is the second action here, not signing in: the header
                is sticky, so Log in is a thumb's reach away for the whole page
                and does not need a third button competing in the opening. */}
            <Button asChild variant="outline" size="lg" className="h-11 px-5 text-[0.95rem]">
              <a href="#about">
                Explore the project
                <ArrowDown className="size-4" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </Reveal>

        <Reveal className="mt-14 md:mt-20">
          <div data-reveal className="reveal-frame mx-auto max-w-6xl">
            <MediaPlaceholder media={landingMedia.hero} variant="browser" />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
