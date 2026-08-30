import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import { maintenanceWorkflowSteps } from '@/domain/unit-maintenance'
import { MAINTENANCE_STATUS_LABELS } from '@/domain/maintenance'
import { SerializedMaintenanceActions } from '@/features/maintenance/SerializedMaintenanceActions'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useOrganization } from '@/features/organizations/useOrganization'
import { hasModuleAccess } from '@/domain/module-access'
import { isOverdue } from '@/domain/maintenance'
import {
  EMPTY_MAINTENANCE_FILTERS,
  filterMaintenanceRecords,
  itemNameById,
  statusLabel,
  maintenanceStatusTone,
  teamDisplay,
  type MaintenanceFilters,
} from '@/features/maintenance/maintenance-view'
import { listInventoryItems } from '@/services/inventory-service'
import { listMaintenanceRecords } from '@/services/maintenance-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { MAINTENANCE_STATUSES, type MaintenanceRecord } from '@/types/maintenance'
import type { InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

function formatDate(stamp: MaintenanceRecord['sent_at']): string {
  return stamp ? stamp.toDate().toLocaleDateString() : '—'
}

export function MaintenanceListPage() {
  const navigate = useNavigate()
  const { organization, membership, role, teams } = useOrganization()
  const [managing, setManaging] = useState<MaintenanceRecord | null>(null)

  /**
   * Whether this row can move the repair along.
   *
   * A finished repair has nothing left to do, a bulk repair has no serialized
   * workflow, and editing follows the team snapshot on the record — the same
   * check the detail page makes.
   */
  function canManage(record: MaintenanceRecord): boolean {
    return maintenanceWorkflowSteps(record).length > 0
      && canEditTeamScopedRecord(role, membership, 'maintenance', record.team_id)
  }
  const organizationId = organization?.organization_id ?? null

  const [records, setRecords] = useState<MaintenanceRecord[] | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MaintenanceFilters>(EMPTY_MAINTENANCE_FILTERS)

  const canCreate = hasModuleAccess(role, membership?.permissions ?? null, 'maintenance', 'edit')
  const now = useMemo(() => new Date(), [])

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    if (!organizationId) return Promise.resolve()

    return Promise.all([
      listMaintenanceRecords(organizationId),
      listInventoryItems(organizationId),
    ]).then(
      ([loadedRecords, loadedItems]) => {
        setRecords(loadedRecords)
        setItems(loadedItems)
        setError(null)
      },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setRecords([]) },
    )
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (records ? filterMaintenanceRecords(records, filters, { items, teams, now }) : []),
    [records, filters, items, teams, now],
  )

  function setFilter<K extends keyof MaintenanceFilters>(key: K, value: MaintenanceFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_MAINTENANCE_FILTERS)

  function StatusCell({ record }: { record: MaintenanceRecord }) {
    const tone = maintenanceStatusTone(record.status)
    const overdue = isOverdue(record, now)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={tone} label={statusLabel(record.status)} />
        {overdue ? <StatusBadge tone="danger" label="Overdue" /> : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Maintenance &amp; Repair</h1>
          <p className="text-muted-foreground text-sm">
            What is broken, what has been sent out, and what is expected back.
          </p>
        </div>
        {canCreate ? (
          <Button asChild size="sm">
            <Link to={paths.maintenanceNew}>
              <Plus className="size-4" aria-hidden="true" />
              Add record
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
            <Input
              value={filters.text}
              onChange={(event) => setFilter('text', event.target.value)}
              placeholder="Search item, team, issue, service provider"
              className="pl-9"
              aria-label="Search maintenance records"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={filters.status} onValueChange={(value) => setFilter('status', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="active">Currently out</SelectItem>
                  {MAINTENANCE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{statusLabel(status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Team</Label>
              <Select value={filters.teamId} onValueChange={(value) => setFilter('teamId', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {teams.map((team) => (
                    <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Overdue</Label>
              <Select value={filters.overdue} onValueChange={(value) => setFilter('overdue', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All records</SelectItem>
                  <SelectItem value="overdue">Overdue only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_MAINTENANCE_FILTERS)}>
              Clear filters
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      {records === null ? (
        <p className="text-muted-foreground text-sm">Loading maintenance records…</p>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium">No repair records yet.</p>
            <p className="text-muted-foreground text-sm">
              {canCreate
                ? 'Add a record when equipment goes out for service.'
                : 'Someone with maintenance edit access can add the first record.'}
            </p>
            {canCreate ? (
              <Button asChild size="sm"><Link to={paths.maintenanceNew}>Add record</Link></Button>
            ) : null}
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="pt-6"><p className="text-muted-foreground text-sm">No records match these filters.</p></CardContent></Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Service provider</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expected back</TableHead>
                  <TableHead className="w-0 text-right">Manage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((record) => {
                  const team = teamDisplay(record, items, teams)
                  return (
                    <TableRow
                      key={record.maintenance_id}
                      className="cursor-pointer"
                      onClick={() => navigate(paths.maintenanceRecord(record.maintenance_id))}
                    >
                      <TableCell className="font-medium">
                        {/* The row click is a convenience; this link is what
                            makes the row reachable by keyboard. */}
                        <Link
                          to={paths.maintenanceRecord(record.maintenance_id)}
                          className="hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {itemNameById(record.item_id, items)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {team.name}
                        {team.historical ? <span className="ml-1 text-xs">(at time of service)</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{record.quantity_sent}</TableCell>
                      <TableCell><StatusCell record={record} /></TableCell>
                      <TableCell className="text-muted-foreground">{record.service_provider_name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(record.sent_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(record.expected_return_at)}</TableCell>
                      {/* Advancing a repair should not require discovering that
                          the row opens a page with the buttons on it. */}
                      <TableCell
                        className="text-right"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex justify-end gap-1">
                          {canManage(record) ? (
                            <Button size="sm" variant="ghost" onClick={() => setManaging(record)}>
                              Manage status
                            </Button>
                          ) : null}
                          <Button asChild size="sm" variant="ghost">
                            <Link to={paths.maintenanceRecord(record.maintenance_id)}>
                              View details
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 md:hidden">
            {visible.map((record) => {
              const team = teamDisplay(record, items, teams)
              return (
                <li key={record.maintenance_id}>
                  <Card>
                    <CardContent className="space-y-2 pt-6">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={paths.maintenanceRecord(record.maintenance_id)}
                          className="min-w-0 flex-1 font-medium hover:underline"
                        >
                          {itemNameById(record.item_id, items)}
                        </Link>
                        <StatusCell record={record} />
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {team.label} · {record.quantity_sent} unit{record.quantity_sent === 1 ? '' : 's'}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {record.service_provider_name ?? 'No provider recorded'} · expected {formatDate(record.expected_return_at)}
                      </p>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {canManage(record) ? (
                          <Button size="sm" variant="outline" onClick={() => setManaging(record)}>
                            Manage status
                          </Button>
                        ) : null}
                        <Button asChild size="sm" variant="outline">
                          <Link to={paths.maintenanceRecord(record.maintenance_id)}>
                            View details
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>

          <p className="text-muted-foreground text-xs">
            {visible.length} of {records.length} record{records.length === 1 ? '' : 's'}
          </p>
        </>
      )}

      {managing ? (
        <Dialog
          open={managing !== null}
          onOpenChange={(open) => { if (!open) setManaging(null) }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{itemNameById(managing.item_id, items)}</DialogTitle>
              <DialogDescription>
                Currently {MAINTENANCE_STATUS_LABELS[managing.status].toLowerCase()}.
                Returning or cancelling brings every piece back at once.
              </DialogDescription>
            </DialogHeader>

            {/* The same actions the record page offers, from the same helper. */}
            <SerializedMaintenanceActions
              record={managing}
              variant="inline"
              onDone={async () => { setManaging(null); await load() }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
