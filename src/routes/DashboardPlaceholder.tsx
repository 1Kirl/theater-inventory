import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { isFirebaseConfigured } from '@/lib/env'

const firebaseReady = isFirebaseConfigured()

/**
 * Phase 0 landing page. Reports foundation status only; the real dashboard is
 * built in Phase 4 once organizations and permissions exist.
 */
export function DashboardPlaceholder() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Theater Inventory Tracker</h1>
        <p className="text-muted-foreground text-sm">
          Foundation is in place. No features have been implemented yet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Foundation status</CardTitle>
          <CardDescription>Phase 0 — project setup</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Build tooling</dt>
              <dd className="font-medium">React, Vite, TypeScript</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Routing</dt>
              <dd className="font-medium">React Router</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Styling</dt>
              <dd className="font-medium">Tailwind CSS, shadcn/ui</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Firebase project</dt>
              <dd className="font-medium">
                {firebaseReady ? 'Configured' : 'Not connected yet'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}
