import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/features/landing/ScrollReveal'
import { paths } from '@/routes/paths'

/**
 * The close.
 *
 * One statement and the two ways in, on the page's only fully tinted band.
 * Nothing else belongs here — anything more competes with the only thing this
 * section is for. The pair is deliberate rather than a menu: somebody who has
 * read the whole page either has a team on this already or is about to start
 * one, and sending both of them through the log-in form loses the second.
 */
export function FinalCtaSection() {
  return (
    <section className="bg-[var(--landing-band)] py-28 md:py-40">
      <Reveal className="mx-auto w-full max-w-4xl px-5 text-center sm:px-8">
        <h2 data-reveal className="landing-h2">
          Ready to step backstage?
        </h2>

        <p data-reveal className="landing-lead reveal-d1 mx-auto mt-6">
          Create an account to set up your organization, or log in if your team already has one.
        </p>

        <div data-reveal className="reveal-d2 mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-12 px-6 text-[0.95rem]">
            <Link to={paths.signUp}>
              Create an account
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 px-6 text-[0.95rem]">
            <Link to={paths.logIn}>Log in</Link>
          </Button>
        </div>
      </Reveal>
    </section>
  )
}
