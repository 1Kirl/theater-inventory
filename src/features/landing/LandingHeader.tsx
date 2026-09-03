import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, Theater } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { paths } from '@/routes/paths'
import { cn } from '@/lib/utils'

const APP_NAME = 'Theater Inventory Tracker'

/** The four places the page will take you, in the order it tells the story. */
const SECTIONS = [
  { href: '#about', label: 'About' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#build-journey', label: 'Build Journey' },
] as const

/**
 * Whether the page has been scrolled away from the top.
 *
 * Answered by watching a one-pixel sentinel rather than by listening to scroll.
 * A scroll handler fires continuously and would have to be throttled; this
 * fires twice in the life of the page — once when the sentinel leaves, once if
 * it comes back.
 */
function useScrolledPast(sentinel: HTMLElement | null): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => { setScrolled(entry !== undefined && !entry.isIntersecting) },
      { threshold: 0 },
    )
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [sentinel])

  return scrolled
}

export function LandingHeader() {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  const scrolled = useScrolledPast(sentinel)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      {/* Sits at the very top of the document; the header watches it. */}
      <div ref={setSentinel} aria-hidden="true" className="h-px w-full" />

      <header
        className={cn(
          'sticky top-0 z-40 transition-colors duration-300',
          scrolled
            ? 'border-border bg-[color-mix(in_oklab,var(--landing-ground)_82%,transparent)] border-b backdrop-blur-md'
            : 'border-transparent border-b',
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-5 sm:px-8">
          <a href="#top" className="focus-visible:ring-ring/50 flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3">
            <span
              className="bg-secondary text-primary flex size-8 items-center justify-center rounded-lg"
              aria-hidden="true"
            >
              <Theater className="size-4" />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              {APP_NAME}
            </span>
            <span className="sr-only sm:hidden">{APP_NAME}</span>
          </a>

          <nav aria-label="Sections of this page" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {SECTIONS.map((section) => (
                <li key={section.href}>
                  <a
                    href={section.href}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent/60 focus-visible:ring-ring/50 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1.5 md:ml-0 md:gap-2">
            {/* Both doors, in the order a returning visitor and a new one need
                them. Log in is quieter because it is the smaller audience, not
                the lesser one — it stays a real button rather than a text link. */}
            <Button asChild variant="ghost">
              <Link to={paths.logIn}>Log in</Link>
            </Button>
            <Button asChild>
              <Link to={paths.signUp}>Get started</Link>
            </Button>

            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open page menu">
                  <Menu className="size-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <SheetHeader>
                  <SheetTitle className="text-sm">{APP_NAME}</SheetTitle>
                  <SheetDescription className="sr-only">
                    Jump to a section of this page.
                  </SheetDescription>
                </SheetHeader>
                <nav aria-label="Sections of this page" className="px-4 pb-4">
                  <ul className="space-y-1">
                    {SECTIONS.map((section) => (
                      <li key={section.href}>
                        <a
                          href={section.href}
                          onClick={() => { setMenuOpen(false) }}
                          className="text-foreground hover:bg-accent/60 focus-visible:ring-ring/50 block rounded-lg px-3 py-2.5 text-base font-medium outline-none focus-visible:ring-3"
                        >
                          {section.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
    </>
  )
}
