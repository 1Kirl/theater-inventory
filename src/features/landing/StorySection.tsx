import { MediaPlaceholder } from '@/features/landing/MediaPlaceholder'
import { Reveal } from '@/features/landing/ScrollReveal'
import { landingMedia } from '@/features/landing/landing-media'

/**
 * Why I Built This.
 *
 * Written in the first person and left that way. This is the one section of the
 * page that is not about the software, and turning it into product copy would
 * remove the only reason it is here.
 *
 * The layout is deliberately off-centre: the headline runs wide across the top,
 * the prose sits in the left six columns, and the photograph hangs in the right
 * five starting a row lower. A centred card would make a personal note look
 * like a feature.
 */
export function StorySection() {
  return (
    <section id="about" className="bg-[var(--landing-ground)] py-24 md:py-36">
      <Reveal className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <p data-reveal className="landing-eyebrow">
          01 / Why I built this
        </p>

        <h2 data-reveal className="landing-h2 reveal-d1 mt-6 max-w-5xl">
          The backstage work was connected.
          <br className="hidden sm:inline" /> The tools weren&rsquo;t.
        </h2>

        <div className="mt-14 grid gap-12 md:mt-20 lg:grid-cols-12 lg:gap-16">
          <div data-reveal className="reveal-d2 space-y-6 lg:col-span-6 lg:col-start-1">
            <p className="landing-body">
              During theatre productions, I realized that some of the most difficult work happens
              behind the stage. Equipment, production requirements, team responsibilities, and
              last-minute changes can easily become scattered across messages, spreadsheets, and
              conversations.
            </p>
            <p className="landing-body">
              I wanted to explore whether one simple digital workspace could make that process
              easier for a student theatre team. That question became the starting point for this
              project.
            </p>
          </div>

          <div
            data-reveal
            className="reveal-right reveal-d3 lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:mt-16"
          >
            <MediaPlaceholder media={landingMedia.story} />
          </div>
        </div>
      </Reveal>
    </section>
  )
}
