import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord, hasModuleAccess } from '@/domain/module-access'
import { ACTION_STATUS_LABELS, ACTION_TYPE_LABELS, requirementAvailability } from '@/domain/production'
import {
  EMPTY_ACTION_FILTERS, filterActionItems, teamNameById, type ActionFilters,
} from '@/features/productions/production-view'
import { listInventoryItems } from '@/services/inventory-service'
import { listActionItems, updateActionItemStatus } from '@/services/action-item-service'
import { listRequirements } from '@/services/production-requirement-service'
import { listProductions } from '@/services/production-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import {
  ACTION_STATUSES, ACTION_TYPES, type ActionItem, type ActionStatus, type Production,
  type ProductionRequirement,
} from '@/types/production'
import type { InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

export function ActionListPage() {
  const { organization, membership, role, teams } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const [actions, setActions] = useState<ActionItem[] | null>(null)
  const [productions, setProductions] = useState<Production[]>([])
  const [requirements, setRequirements] = useState<ProductionRequirement[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<ActionFilters>(EMPTY_ACTION_FILTERS)
  const [busyId, setBusyId] = useState<string | null>(null)

  const canReadInventory = hasModuleAccess(role, membership?.permissions ?? null, 'inventory', 'view')

  const load = useCallback(async () => {
    if (!organizationId) return
    setError(null)
    try {
      const [loadedActions, loadedProductions, loadedRequirements] = await Promise.all([
        listActionItems(organizationId),
        listProductions(organizationId),
        listRequirements(organizationId),
      ])
      setActions(loadedActions)
      setProductions(loadedProductions)
      setRequirements(loadedRequirements)

      if (canReadInventory) {
        setItems(await listInventoryItems(organizationId).catch(() => []))
      }
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setActions([])
    }
  }, [organizationId, canReadInventory])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (actions ? filterActionItems(actions, filters, { productions, teams }) : []),
    [actions, filters, productions, teams],
  )

  function setFilter<K extends keyof ActionFilters>(key: K, value: ActionFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  /**
   * Status is the one field editable from here — a quick operational control.
   * Everything else about an action is edited from its production.
   */
  async function changeStatus(action: ActionItem, status: ActionStatus) {
    if (busyId) return

    setBusyId(action.action_item_id)
    setError(null)
    try {
      await updateActionItemStatus({ actionItemId: action.action_item_id, status })
      // Reflect immediately rather than reloading the whole list.
      setActions((current) =>
        (current ?? []).map((entry) =>
          entry.action_item_id === action.action_item_id ? { ...entry, status } : entry,
        ),
      )
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Edit scope follows the action's own team, exactly as the write rule does.
   * Hiding the control is a convenience; Security Rules are what enforce it.
   */
  function StatusControl({ action }: { action: ActionItem }) {
    const mayEdit = canEditTeamScopedRecord(role, membership, 'productions', action.team_id)

    if (!mayEdit) {
      return <Badge variant="outline">{ACTION_STATUS_LABELS[action.status]}</Badge>
    }

    return (
      <Select
        value={action.status}
        onValueChange={(value) => changeStatus(action, value as ActionStatus)}
        disabled={busyId === action.action_item_id}
      >
        <SelectTrigger className="h-8 w-36" aria-label={`Status for ${action.item_name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>{ACTION_STATUS_LABELS[status]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  /** Recomputed live, and deliberately separate from the action's own quantity. */
  function currentShortage(action: ActionItem): string {
    if (!canReadInventory) return '—'
    const requirement = requirements.find((entry) => entry.requirement_id === action.requirement_id)
    if (!requirement) return '—'

    const availability = requirementAvailability(requirement, items)
    return availability.matched ? String(availability.shortage) : 'Not Matched'
  }

  function productionTitle(action: ActionItem): string {
    return productions.find((p) => p.production_id === action.production_id)?.title ?? 'Unknown production'
  }

  const filtersActive = JSON.stringify(filters) !== JSON.stringify(EMPTY_ACTION_FILTERS)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Action List</h1>
        <p className="text-muted-foreground text-sm">
          What still has to be bought, rented, built, or repaired. Actions are planned from a
          production's requirements.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden="true" />
            <Input value={filters.text} onChange={(e) => setFilter('text', e.target.value)} placeholder="Search item, production, team" className="pl-9" aria-label="Search actions" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Production</Label>
              <Select value={filters.productionId} onValueChange={(v) => setFilter('productionId', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All productions</SelectItem>
                  {productions.map((p) => (
                    <SelectItem key={p.production_id} value={p.production_id}>{p.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Team</Label>
              <Select value={filters.teamId} onValueChange={(v) => setFilter('teamId', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All teams</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.team_id} value={t.team_id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Action</Label>
              <Select value={filters.actionType} onValueChange={(v) => setFilter('actionType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{ACTION_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilter('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="open">Still open</SelectItem>
                  {ACTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ACTION_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_ACTION_FILTERS)}>Clear filters</Button>
          ) : null}
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      {actions === null ? (
        <p className="text-muted-foreground text-sm">Loading actions…</p>
      ) : actions.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium">Nothing to action yet.</p>
            <p className="text-muted-foreground text-sm">
              Actions appear here once a production requirement is matched to inventory and comes up
              short.
            </p>
            <Button asChild variant="outline" size="sm"><Link to={paths.productions}>Go to productions</Link></Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="pt-6"><p className="text-muted-foreground text-sm">No actions match these filters.</p></CardContent></Card>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Production</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Current shortage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((action) => (
                  <TableRow key={action.action_item_id}>
                    <TableCell className="font-medium">{action.item_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <Link to={paths.production(action.production_id)} className="underline underline-offset-4">
                        {productionTitle(action)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{teamNameById(action.team_id, teams)}</TableCell>
                    <TableCell><Badge variant="secondary">{ACTION_TYPE_LABELS[action.action_type]}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{action.quantity}</TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">{currentShortage(action)}</TableCell>
                    <TableCell><StatusControl action={action} /></TableCell>
                    <TableCell className="text-muted-foreground">
                      {action.due_date ? action.due_date.toDate().toLocaleDateString() : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="space-y-3 md:hidden">
            {visible.map((action) => (
              <li key={action.action_item_id}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 font-medium">{action.item_name}</span>
                      <Badge variant="secondary">{ACTION_TYPE_LABELS[action.action_type]}</Badge>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {productionTitle(action)} · {teamNameById(action.team_id, teams)}
                    </p>
                    <p className="text-sm tabular-nums">
                      Plan {action.quantity} · current shortage {currentShortage(action)}
                    </p>
                    <div className="pt-1"><StatusControl action={action} /></div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground text-xs">
            {visible.length} of {actions.length} action{actions.length === 1 ? '' : 's'}
          </p>
        </>
      )}
    </div>
  )
}
