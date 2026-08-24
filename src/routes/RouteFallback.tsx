import { Card, CardContent } from '@/components/ui/card'

/**
 * Shown while a route's code is being fetched.
 *
 * Deliberately the same shape as a page that is loading its data: a heading
 * placeholder and a card. A spinner in the middle of an empty screen would make
 * a fast chunk fetch look like a stall, and a blank screen would look like a
 * failure.
 */
export function RouteFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="bg-muted h-8 w-48 animate-pulse rounded-md" aria-hidden="true" />
      <Card aria-hidden="true">
        <CardContent className="space-y-3 pt-6">
          <div className="bg-muted h-4 w-full animate-pulse rounded" />
          <div className="bg-muted h-4 w-5/6 animate-pulse rounded" />
          <div className="bg-muted h-4 w-2/3 animate-pulse rounded" />
        </CardContent>
      </Card>
    </div>
  )
}
