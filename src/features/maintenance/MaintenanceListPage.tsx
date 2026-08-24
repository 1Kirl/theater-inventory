import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  statusTone,
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
  const organizationId = organization?.organization_id ?? null

  const [records, setRecords] = useState<MaintenanceRecord[] | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<MaintenanceFilters>(EMPTY_MAINTENANCE_FILTERS)

  const canCreate = hasModuleAccess(role, membership?.permissions ?? null, 'maintenance', 'edit')
  const now = useMemo(() => new Date(), [])

  const load = useCallback(async () => {
    if (!organizationId) return
    setError(null)
    try {
      const [loadedRecords, loadedItems] = await Promise.all([
        listMaintenanceRecords(organizationId),
        listInventoryItems(organizationId),
      ])
      setRecords(loadedRecords)
      setItems(loadedItems)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setRecords([])
    }
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
    const tone = statusTone(record.status)
    const overdue = isOverdue(record, now)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={tone === 'active' ? 'default' : tone === 'pending' ? 'outline' : 'secondary'}>
          {statusLabel(record.status)}
        </Badge>
        {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
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
                      <TableCell className="font-medium">{itemNameById(record.item_id, items)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {team.name}
                        {team.historical ? <span className="ml-1 text-xs">(at time of service)</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{record.quantity_sent}</TableCell>
                      <TableCell><StatusCell record={record} /></TableCell>
                      <TableCell className="text-muted-foreground">{record.service_provider_name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(record.sent_at)}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(record.expected_return_at)}</TableCell>
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
                  <Link to={paths.maintenanceRecord(record.maintenance_id)} className="block">
                    <Card>
                      <CardContent className="space-y-2 pt-6">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1 font-medium">{itemNameById(record.item_id, items)}</span>
                          <StatusCell record={record} />
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {team.label} · {record.quantity_sent} unit{record.quantity_sent === 1 ? '' : 's'}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {record.service_provider_name ?? 'No provider recorded'} · expected {formatDate(record.expected_return_at)}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>

          <p className="text-muted-foreground text-xs">
            {visible.length} of {records.length} record{records.length === 1 ? '' : 's'}
          </p>
        </>
      )}
    </div>
  )
}
