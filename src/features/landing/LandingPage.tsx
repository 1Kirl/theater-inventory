import { LandingHeader } from '@/features/landing/LandingHeader'
import { HeroSection } from '@/features/landing/HeroSection'
import { StorySection } from '@/features/landing/StorySection'
import { ProblemSection } from '@/features/landing/ProblemSection'
import { WorkspaceSection } from '@/features/landing/WorkspaceSection'
import { FeatureShowcase } from '@/features/landing/FeatureShowcase'
import { HowItWorksSection } from '@/features/landing/HowItWorksSection'
import { BuildJourneySection } from '@/features/landing/BuildJourneySection'
import { FinalCtaSection } from '@/features/landing/FinalCtaSection'
import { ProductionMarquee } from '@/features/landing/ProductionMarquee'
import { LandingFooter } from '@/features/landing/LandingFooter'
import '@/features/landing/landing.css'

/**
 * The public page at `/`, shown to visitors who are not signed in.
 *
 * `LandingGate` decides whether this renders at all; this component knows
 * nothing about authentication and holds no application state. The only class
 * that matters structurally is `landing-root`: every rule in `landing.css` is
 * scoped under it, so nothing here can reach the authenticated application, and
 * the smooth-scroll rule keyed on its presence stops applying the moment this
 * page unmounts.
 */
export function LandingPage() {
  return (
    <div className="landing-root min-h-svh">
      <LandingHeader />

      <main>
        <HeroSection />
        <StorySection />
        <ProblemSection />
        <WorkspaceSection />
        <FeatureShowcase />
        <HowItWorksSection />
        <BuildJourneySection />
        <FinalCtaSection />
        <ProductionMarquee />
      </main>

      <LandingFooter />
    </div>
  )
}
