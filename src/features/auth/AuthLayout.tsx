import { Outlet } from 'react-router-dom'
import { Theater } from 'lucide-react'

/**
 * Centered, single-column layout for the pre-organization auth screens.
 *
 * The mark above the title is the only decoration, and it is doing a small job:
 * these are the screens somebody sees before the application has any content of
 * its own, and a bare heading on a white page gives no sense of what they have
 * arrived at. It is one tinted square, not a landing page — the layout below it
 * is unchanged.
 */
export function AuthLayout() {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3">
        <span
          className="bg-secondary text-primary flex size-11 items-center justify-center rounded-xl"
          aria-hidden="true"
        >
          <Theater className="size-5" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">Theater Inventory Tracker</h1>
      </div>
      <Outlet />
    </div>
  )
}
