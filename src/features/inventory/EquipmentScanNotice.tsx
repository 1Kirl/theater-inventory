import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { getOrganization } from '@/services/organization-service'
import type { EquipmentScanOutcome } from '@/features/inventory/equipment-scan-view'
import { paths } from '@/routes/paths'

/**
 * What a scanned label shows when it does not open straight onto the equipment.
 *
 * Denied and absent are deliberately one message: Rules cannot tell them apart
 * for the client, and pretending otherwise would let a stranger use a scanner to
 * confirm which unit ids are real.
 */
export function EquipmentScanNotice({ outcome }: { outcome: EquipmentScanOutcome }) {
  if (outcome.kind === 'ready') return null

  if (outcome.kind === 'resolving') {
    return <p className="text-muted-foreground text-sm">Loading equipment…</p>
  }

  if (outcome.kind === 'other_organization') {
    return (
      <SwitchOrganization
        organizationId={outcome.organizationId}
        hasActiveOrganization={outcome.hasActiveOrganization}
      />
    )
  }

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertDescription>{outcome.message}</AlertDescription>
      </Alert>
      <Button asChild variant="outline" size="sm">
        <Link to={paths.dashboard}>Go to your dashboard</Link>
      </Button>
    </div>
  )
}

/**
 * The equipment is readable, just not in the organization currently open.
 *
 * Security Rules already allowed the read, which is the only thing that decides
 * whether this person may see the unit — so this is browser state, not
 * authorization.
 *
 * When another organization *is* open, switching is offered rather than done
 * for them: the active organization is global, and changing it silently would
 * move every other page and tab they have open. The organization's name is the
 * only thing shown before they choose; nothing about the equipment appears
 * until they have.
 *
 * When none is open there is nothing to move and nobody to surprise, so the
 * unit's organization is simply opened. This is the ordinary end of a scanned
 * label: signing out clears the stored organization, so somebody who scans a
 * sticker, signs in, and lands here has none — and asking them to pick the
 * organization of equipment they are holding, which the application has already
 * read and authorized, would be a question with one answer.
 */
function SwitchOrganization({
  organizationId,
  hasActiveOrganization,
}: {
  organizationId: string
  hasActiveOrganization: boolean
}) {
  const { selectOrganization } = useOrganization()
  const [name, setName] = useState<string | null>(null)
  // Once per organization. If activating it somehow does not take, this must
  // not become a loop that retries forever behind a blank screen.
  const opened = useRef<string | null>(null)

  useEffect(() => {
    if (hasActiveOrganization) return
    if (opened.current === organizationId) return
    opened.current = organizationId
    selectOrganization(organizationId)
  }, [hasActiveOrganization, organizationId, selectOrganization])

  useEffect(() => {
    let live = true
    getOrganization(organizationId).then(
      (organization) => { if (live && organization) setName(organization.name) },
      // A name is a nicety. Without it the button still says what it does.
      () => {},
    )
    return () => { live = false }
  }, [organizationId])

  if (!hasActiveOrganization) {
    return <p className="text-muted-foreground text-sm">Opening {name ?? 'equipment'}…</p>
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-base">This equipment belongs to</CardTitle>
        <CardDescription>
          You have access to it, but a different organization is open right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Building2 className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{name ?? 'Another of your organizations'}</span>
        </p>

        <div className="flex flex-wrap gap-2">
          {/* Nothing navigates: the route stays exactly where the label pointed,
              and the page re-resolves once the organization has changed. */}
          <Button onClick={() => { selectOrganization(organizationId) }}>
            Switch organization and view equipment
          </Button>
          <Button asChild variant="outline">
            <Link to={paths.dashboard}>Not now</Link>
          </Button>
        </div>

        <p className="text-muted-foreground text-xs">
          Switching changes which organization the whole application is working in.
        </p>
      </CardContent>
    </Card>
  )
}
