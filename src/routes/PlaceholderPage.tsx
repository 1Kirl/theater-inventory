import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface PlaceholderPageProps {
  title: string
  phase: string
}

/**
 * Temporary page used by the Phase 0 shell. Each route is replaced by its real
 * module in the phase named here.
 */
export function PlaceholderPage({ title, phase }: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">
          This module has not been built yet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not implemented</CardTitle>
          <CardDescription>Scheduled for {phase}.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          The application shell, routing, and design system are in place. Feature
          work begins in the phase above.
        </CardContent>
      </Card>
    </div>
  )
}
