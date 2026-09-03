import { Theater } from 'lucide-react'

/**
 * Minimal by intention.
 *
 * No contact address, no social accounts, no school link. None of those exist
 * for this project, and inventing them would be the one dishonest thing on an
 * otherwise honest page.
 */
export function LandingFooter() {
  return (
    <footer className="border-border bg-[var(--landing-ground)] border-t">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-2.5">
          <span
            className="bg-secondary text-primary flex size-7 items-center justify-center rounded-lg"
            aria-hidden="true"
          >
            <Theater className="size-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Theater Inventory Tracker</span>
        </div>

        <p className="text-muted-foreground text-sm">
          High School Theater Technology Project · © 2026
        </p>
      </div>
    </footer>
  )
}
