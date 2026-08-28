import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import { CONDITION_LABELS } from '@/domain/inventory'
import { UNIT_STATUS_LABELS, unitBadgeVariant } from '@/features/inventory/inventory-unit-view'
import { InventoryUnitDialog } from '@/features/inventory/InventoryUnitDialog'
import { UnitLifecycleDialog } from '@/features/inventory/UnitLifecycleDialog'
import {
  eventDetail, eventLabel, lifecyclePanel, retirementLabel,
} from '@/features/inventory/unit-lifecycle-view'
import { listUnitHistory } from '@/services/unit-lifecycle-service'
import { getMaintenanceRecord } from '@/services/maintenance-service'
import { MAINTENANCE_STATUS_LABELS } from '@/domain/maintenance'
import type { MaintenanceRecord } from '@/types/maintenance'
import { getUserProfiles } from '@/services/user-service'
import type { AssetEvent } from '@/types/asset-event'
import { getInventoryItem } from '@/services/inventory-service'
import { getInventoryUnit, listAssetCodes } from '@/services/inventory-unit-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem, InventoryUnit, UnitStatus } from '@/types/inventory'
import { paths } from '@/routes/paths'

/**
 * One physical unit.
 *
 * Its parent is loaded alongside it because the unit's own document does not
 * carry the item name, and because editing a unit needs the item the write is
 * counted against.
 */
export function InventoryUnitDetailPage() {
  const { unitId } = useParams<{ unitId: string }>()
  const { organization, membership, role, teams } = useOrganization()

  const [unit, setUnit] = useState<InventoryUnit | null | undefined>(undefined)
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [codes, setCodes] = useState<string[]>([])
  const [history, setHistory] = useState<AssetEvent[]>([])
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map())
  const [action, setAction] = useState<{ to: UnitStatus | null; label: string } | null>(null)
  const [currentMaintenance, setCurrentMaintenance] = useState<MaintenanceRecord | null>(null)
  const [pastMaintenance, setPastMaintenance] = useState<MaintenanceRecord[]>([])
  const [plannedMaintenance, setPlannedMaintenance] = useState<MaintenanceRecord | null>(null)

  const load = useCallback((): Promise<void> => {
    if (!unitId) return Promise.resolve()

    async function read() {
      const unit = await getInventoryUnit(unitId as string)
      const item = unit ? await getInventoryItem(unit.inventory_item_id) : null
      const codes = unit ? await listAssetCodes(unit.organization_id).catch(() => []) : []

      // Read by id from the unit's own fields: the current repair from its
      // pointer, the past ones from its list. No collection search, no index,
      // and nothing shown that the unit does not itself vouch for.
      const currentMaintenance = unit?.current_maintenance_record_id
        ? await getMaintenanceRecord(unit.current_maintenance_record_id).catch(() => null)
        : null
      // Read by id from the unit's own pointer. A plan is not a repair, so it
      // gets its own section rather than being folded into the current one.
      const plannedMaintenance = unit?.planned_maintenance_record_id
        ? await getMaintenanceRecord(unit.planned_maintenance_record_id).catch(() => null)
        : null
      const pastMaintenance = (
        await Promise.all(
          (unit?.maintenance_record_ids ?? [])
            .filter((id) => id !== unit?.current_maintenance_record_id)
            .map((id) => getMaintenanceRecord(id).catch(() => null)),
        )
      ).filter((record): record is MaintenanceRecord => record !== null)

      const history = unit
        ? await listUnitHistory({
          organizationId: unit.organization_id,
          unitId: unit.unit_id,
        }).catch(() => [])
        : []

      // Who did what, in the names people actually use. The same profile
      // lookup the members screen uses; no second identity system. The person
      // currently holding the unit is included because they may never have
      // appeared in the history — somebody else can check equipment out to them.
      const names = new Map<string, string>()
      const uids = new Set(history.map((event) => event.actor_uid))
      if (unit?.using_member_uid) uids.add(unit.using_member_uid)

      if (uids.size > 0) {
        const profiles = await getUserProfiles([...uids]).catch(() => new Map())
        for (const [uid, profile] of profiles) names.set(uid, profile.display_name)
      }
      const actorNames = names

      return {
        unit, item, codes, history, actorNames, currentMaintenance, pastMaintenance,
        plannedMaintenance,
      }
    }

    return read().then(
      (loaded) => {
        setUnit(loaded.unit); setItem(loaded.item); setCodes(loaded.codes)
        setHistory(loaded.history); setActorNames(loaded.actorNames)
        setCurrentMaintenance(loaded.currentMaintenance)
        setPlannedMaintenance(loaded.plannedMaintenance)
        setPastMaintenance(loaded.pastMaintenance); setError(null)
      },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setUnit(null) },
    )
  }, [unitId])

  useEffect(() => {
    void load()
  }, [load])

  if (unit === undefined) {
    return <p className="text-muted-foreground text-sm">Loading unit…</p>
  }

  if (error) {
    return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  }

  if (!unit || unit.organization_id !== organization?.organization_id) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>That unit was not found in this organization.</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to={paths.inventory}>Back to inventory</Link>
        </Button>
      </div>
    )
  }

  const canEdit = canEditTeamScopedRecord(role, membership, 'inventory', unit.team_id)
  const teamName = teams.find((team) => team.team_id === unit.team_id)?.name ?? 'Unknown team'
  // One helper decides whether the section appears and what is in it, so the
  // page and its test agree rather than each working it out separately.
  const panel = lifecyclePanel({ unit, role, membership })

  const usingTeamName = unit.using_team_id
    ? teams.find((team) => team.team_id === unit.using_team_id)?.name ?? 'Unknown team'
    : null
  const usingMemberName = unit.using_member_uid
    ? actorNames.get(unit.using_member_uid) ?? null
    : null

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={paths.inventoryItem(unit.inventory_item_id)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {item ? item.name : 'Item'}
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{unit.asset_code}</h1>
            <p className="text-muted-foreground text-sm">
              {item ? `${item.name} · ` : ''}{teamName}
            </p>
          </div>
          {canEdit && item ? (
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This unit</CardTitle>
          <CardDescription>
            This unit&rsquo;s own team, condition, and whereabouts. Status follows what happens to
            the equipment; condition is recorded by hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-sm">Status</dt>
              <dd className="pt-1">
                <Badge variant={unitBadgeVariant(unit.status)}>
                  {UNIT_STATUS_LABELS[unit.status]}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Condition</dt>
              <dd className="pt-1">
                <Badge variant="secondary">{CONDITION_LABELS[unit.condition]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Owning team</dt>
              <dd className="pt-1 text-sm">{teamName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Stored</dt>
              <dd className="pt-1 text-sm">{unit.storage_location}</dd>
            </div>
            {/* Only while it is out. Once it comes back these fields are gone
                from the unit, and the history is what remembers. */}
            {usingTeamName ? (
              <div>
                <dt className="text-muted-foreground text-sm">Using team</dt>
                <dd className="pt-1 text-sm">{usingTeamName}</dd>
              </div>
            ) : null}
            {usingMemberName ? (
              <div>
                <dt className="text-muted-foreground text-sm">Using member</dt>
                <dd className="pt-1 text-sm">{usingMemberName}</dd>
              </div>
            ) : null}
            {unit.checked_out_at ? (
              <div>
                <dt className="text-muted-foreground text-sm">Checked out</dt>
                <dd className="pt-1 text-sm">
                  {unit.checked_out_at.toDate().toLocaleDateString()}
                </dd>
              </div>
            ) : null}
            {unit.retirement_reason ? (
              <div>
                <dt className="text-muted-foreground text-sm">Retired because</dt>
                <dd className="pt-1 text-sm">{retirementLabel(unit.retirement_reason)}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {panel.visible ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              What can happen to this unit from where it is now. Each one is recorded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {panel.actions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {panel.actions.map((option) => (
                  <Button
                    key={option.to}
                    size="sm"
                    variant={option.tone}
                    onClick={() => setAction({ to: option.to, label: option.label })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {panel.reason ?? 'Nothing can be done with this unit right now.'}
              </p>
            )}
            {panel.actions.length > 0 && panel.reason ? (
              <p className="text-muted-foreground mt-3 text-sm">{panel.reason}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {currentMaintenance ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current repair</CardTitle>
            <CardDescription>
              This unit is away. The details live on the repair record rather than being copied
              here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-sm">Status</dt>
                <dd className="pt-1 text-sm">
                  {MAINTENANCE_STATUS_LABELS[currentMaintenance.status]}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">Service provider</dt>
                <dd className="pt-1 text-sm">
                  {currentMaintenance.service_provider_name ?? 'Not recorded'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">Expected back</dt>
                <dd className="pt-1 text-sm">
                  {currentMaintenance.expected_return_at
                    ? currentMaintenance.expected_return_at.toDate().toLocaleDateString()
                    : 'Not recorded'}
                </dd>
              </div>
            </dl>
            <Button asChild size="sm" variant="outline">
              <Link to={paths.maintenanceRecord(currentMaintenance.maintenance_id)}>
                View repair
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {plannedMaintenance && !currentMaintenance ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Planned maintenance</CardTitle>
            <CardDescription>
              This unit is intended for a repair that has not started. It is not reserved and may
              still be used; availability is checked again when the repair begins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground text-sm">Service provider</dt>
                <dd className="pt-1 text-sm">
                  {plannedMaintenance.service_provider_name ?? 'Not recorded'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">Planned for</dt>
                <dd className="pt-1 text-sm">
                  {plannedMaintenance.sent_at
                    ? plannedMaintenance.sent_at.toDate().toLocaleDateString()
                    : 'No date set'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-sm">Issue</dt>
                <dd className="pt-1 text-sm">{plannedMaintenance.issue_description}</dd>
              </div>
            </dl>
            <Button asChild size="sm" variant="outline">
              <Link to={paths.maintenanceRecord(plannedMaintenance.maintenance_id)}>
                View plan
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {pastMaintenance.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Repair history</CardTitle>
            <CardDescription>
              Every repair this exact piece of equipment has been through.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {[...pastMaintenance]
                .sort((left, right) =>
                  (right.created_at?.toMillis() ?? 0) - (left.created_at?.toMillis() ?? 0))
                .map((record) => (
                  <li key={record.maintenance_id} className="border-l-2 pl-4">
                    <p className="text-muted-foreground text-xs">
                      {record.sent_at
                        ? record.sent_at.toDate().toLocaleDateString()
                        : record.created_at?.toDate().toLocaleDateString() ?? ''}
                      {record.returned_at
                        ? ` — back ${record.returned_at.toDate().toLocaleDateString()}`
                        : ''}
                    </p>
                    <p className="font-medium">
                      {record.service_provider_name ?? 'Repair'}
                    </p>
                    <p className="text-sm">{record.issue_description}</p>
                    <p className="text-muted-foreground text-sm">
                      {MAINTENANCE_STATUS_LABELS[record.status]}
                      {typeof record.cost === 'number'
                        ? ` · ${record.cost.toLocaleString()}`
                        : ''}
                    </p>
                    <Button asChild size="sm" variant="ghost" className="-ml-3 mt-1">
                      <Link to={paths.maintenanceRecord(record.maintenance_id)}>View record</Link>
                    </Button>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle history</CardTitle>
          <CardDescription>
            What has happened to this piece of equipment. Newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing has happened to this unit yet.
            </p>
          ) : (
            <ol className="space-y-4">
              {history.map((event) => {
                const detail = eventDetail(event, (teamId) =>
                  teams.find((team) => team.team_id === teamId)?.name ?? 'a team that no longer exists')

                return (
                  <li key={event.event_id} className="border-l-2 pl-4">
                    <p className="text-muted-foreground text-xs">
                      {event.occurred_at
                        ? event.occurred_at.toDate().toLocaleString()
                        : 'Just now'}
                    </p>
                    <p className="font-medium">{eventLabel(event)}</p>
                    {detail ? <p className="text-sm">{detail}</p> : null}
                    {event.note ? (
                      <p className="text-muted-foreground text-sm">{event.note}</p>
                    ) : null}
                    <p className="text-muted-foreground text-xs">
                      By {actorNames.get(event.actor_uid) ?? 'a member who has since left'}
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {unit.notes ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{unit.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {action ? (
        <UnitLifecycleDialog
          unit={unit}
          to={action.to}
          label={action.label}
          open={action !== null}
          onOpenChange={(next) => { if (!next) setAction(null) }}
          onDone={load}
        />
      ) : null}

      {editing && item ? (
        <InventoryUnitDialog
          item={item}
          existing={unit}
          usedCodes={codes}
          open={editing}
          onOpenChange={setEditing}
          onSaved={load}
          onManageStatus={() => {
            // Same handoff as the unit list: close this, open that.
            setEditing(false)
            setAction({ to: null, label: '' })
          }}
        />
      ) : null}
    </div>
  )
}
