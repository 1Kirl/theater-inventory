import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord, hasModuleAccess } from '@/domain/module-access'
import {
  ACTION_STATUS_LABELS, ALREADY_AVAILABLE_LABEL, PRODUCTION_STATUS_LABELS, canCreateActionItem,
} from '@/domain/production'
import {
  actionPlaceholder, actionSummary, availabilityLabel, buildRequirementRows, shortageLabel,
  summarizeProduction, type RequirementRow,
} from '@/features/productions/production-view'
import { ActionItemDialog } from '@/features/productions/ActionItemDialog'
import { RequirementDialog } from '@/features/productions/RequirementDialog'
import { listInventoryItems } from '@/services/inventory-service'
import { listActionItemsForProduction } from '@/services/action-item-service'
import { listRequirementsForProduction } from '@/services/production-requirement-service'
import { getProduction } from '@/services/production-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import { paths } from '@/routes/paths'

export function ProductionDetailPage() {
  const { productionId } = useParams<{ productionId: string }>()
  const { organization, membership, role, teams } = useOrganization()

  const [production, setProduction] = useState<Production | null | undefined>(undefined)
  const [requirements, setRequirements] = useState<ProductionRequirement[]>([])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [items, setItems] = useState<InventoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editingRequirement, setEditingRequirement] = useState<ProductionRequirement | null | undefined>(undefined)
  const [actioning, setActioning] = useState<RequirementRow | null>(null)

  const canEdit = hasModuleAccess(role, membership?.permissions ?? null, 'productions', 'edit')
  // Matching needs inventory access; the requirement itself does not.
  const canReadInventory = hasModuleAccess(role, membership?.permissions ?? null, 'inventory', 'view')

  const load = useCallback(async () => {
    if (!productionId || !organization) return
    setError(null)
    try {
      const loaded = await getProduction(productionId)
      setProduction(loaded)
      if (!loaded) return

      const [loadedRequirements, loadedActions] = await Promise.all([
        listRequirementsForProduction({ organizationId: organization.organization_id, productionId }),
        listActionItemsForProduction({ organizationId: organization.organization_id, productionId }),
      ])
      setRequirements(loadedRequirements)
      setActions(loadedActions)

      if (canReadInventory) {
        setItems(await listInventoryItems(organization.organization_id).catch(() => []))
      }
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setProduction(null)
    }
  }, [productionId, organization, canReadInventory])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () => buildRequirementRows({ requirements, items, actions, teams }),
    [requirements, items, actions, teams],
  )
  const summary = summarizeProduction(rows)

  if (production === undefined) return <p className="text-muted-foreground text-sm">Loading production…</p>
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>

  if (!production || production.organization_id !== organization?.organization_id) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive"><AlertDescription>That production was not found in this organization.</AlertDescription></Alert>
        <Button asChild variant="outline" size="sm"><Link to={paths.productions}>Back to productions</Link></Button>
      </div>
    )
  }

  function RequirementActions({ row }: { row: RequirementRow }) {
    const mayEditRow = canEditTeamScopedRecord(role, membership, 'productions', row.requirement.team_id)
    if (!mayEditRow) return null

    return (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditingRequirement(row.requirement)}>Edit</Button>
        {row.action || canCreateActionItem(row.availability) ? (
          <Button size="sm" variant="ghost" onClick={() => setActioning(row)}>
            {row.action ? 'Edit action' : 'Plan action'}
          </Button>
        ) : null}
      </div>
    )
  }

  function ActionCell({ row }: { row: RequirementRow }) {
    if (row.action) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{actionSummary(row.action)}</Badge>
          <span className="text-muted-foreground text-xs">{ACTION_STATUS_LABELS[row.action.status]}</span>
        </div>
      )
    }
    const placeholder = actionPlaceholder(row.availability)
    return placeholder === ALREADY_AVAILABLE_LABEL ? (
      <Badge variant="outline">{placeholder}</Badge>
    ) : (
      <span className="text-muted-foreground text-sm">{placeholder}</span>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={paths.productions}><ArrowLeft className="size-4" aria-hidden="true" />Productions</Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{production.title}</h1>
            <Badge variant={production.status === 'active' ? 'default' : production.status === 'completed' ? 'secondary' : 'outline'}>
              {PRODUCTION_STATUS_LABELS[production.status]}
            </Badge>
          </div>
          {canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link to={paths.productionEdit(production.production_id)}>
                <Pencil className="size-4" aria-hidden="true" />Edit production
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-sm">Requirements</dt>
              <dd className="text-2xl font-semibold tabular-nums">{summary.requirementCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">With a shortage</dt>
              <dd className="text-2xl font-semibold tabular-nums">{summary.shortageCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Open actions</dt>
              <dd className="text-2xl font-semibold tabular-nums">{summary.openActionCount}</dd>
            </div>
          </dl>
          {production.description ? (
            <p className="text-muted-foreground mt-4 text-sm whitespace-pre-wrap">{production.description}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Requirements</CardTitle>
              <CardDescription>
                Availability comes from each matched item's available quantity, read live.
              </CardDescription>
            </div>
            {canEdit ? (
              <Button size="sm" onClick={() => setEditingRequirement(null)}>
                <Plus className="size-4" aria-hidden="true" />Add requirement
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No requirements yet. Add what this production needs.
            </p>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Needed</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Required</TableHead>
                      <TableHead>Matched</TableHead>
                      <TableHead className="text-right">Available</TableHead>
                      <TableHead className="text-right">Shortage</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.requirement.requirement_id}>
                        <TableCell className="font-medium">{row.requirement.item_name}</TableCell>
                        <TableCell className="text-muted-foreground">{row.teamName}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.requirement.required_qty}</TableCell>
                        <TableCell className="text-muted-foreground">{row.matchedName}</TableCell>
                        <TableCell className="text-right tabular-nums">{availabilityLabel(row.availability)}</TableCell>
                        <TableCell className="text-right tabular-nums">{shortageLabel(row.availability)}</TableCell>
                        <TableCell><ActionCell row={row} /></TableCell>
                        <TableCell><RequirementActions row={row} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="space-y-3 md:hidden">
                {rows.map((row) => (
                  <li key={row.requirement.requirement_id} className="border-border rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 font-medium">{row.requirement.item_name}</span>
                      <ActionCell row={row} />
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {row.teamName} · matched: {row.matchedName}
                    </p>
                    <p className="mt-1 text-sm tabular-nums">
                      Required {row.requirement.required_qty} · Available {availabilityLabel(row.availability)} · Shortage {shortageLabel(row.availability)}
                    </p>
                    <div className="mt-2"><RequirementActions row={row} /></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {editingRequirement !== undefined ? (
        <RequirementDialog
          key={editingRequirement?.requirement_id ?? 'new'}
          productionId={production.production_id}
          existing={editingRequirement}
          items={items}
          canReadInventory={canReadInventory}
          open
          onOpenChange={(open) => { if (!open) setEditingRequirement(undefined) }}
          onSaved={load}
        />
      ) : null}

      {actioning ? (
        <ActionItemDialog
          key={actioning.requirement.requirement_id}
          requirement={actioning.requirement}
          availability={actioning.availability}
          existing={actioning.action}
          open
          onOpenChange={(open) => { if (!open) setActioning(null) }}
          onSaved={load}
        />
      ) : null}
    </div>
  )
}
