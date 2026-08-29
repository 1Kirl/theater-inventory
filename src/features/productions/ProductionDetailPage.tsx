import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Sparkles } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord, hasModuleAccess } from '@/domain/module-access'
import {
  ACTION_STATUS_LABELS, ACTION_TYPE_LABELS, ALREADY_AVAILABLE_LABEL, PRODUCTION_STATUS_LABELS,
  canCreateActionItem,
} from '@/domain/production'
import {
  actionPlaceholder, actionSummary, availabilityLabel, buildRequirementRows, shortageLabel,
  summarizeProduction, type RequirementRow,
} from '@/features/productions/production-view'
import { ActionItemDialog } from '@/features/productions/ActionItemDialog'

/**
 * The generator carries the Firebase AI SDK with it, so it is fetched only when
 * someone opens it. Nothing else on this page waits for it.
 */
const RequirementGeneratorDialog = lazy(() => import('@/features/ai/RequirementGeneratorDialog')
  .then((m) => ({ default: m.RequirementGeneratorDialog })))
import { RequirementDialog } from '@/features/productions/RequirementDialog'
import { listInventoryItems } from '@/services/inventory-service'
import { listActionItemsForProduction } from '@/services/action-item-service'
import { listRequirementsForProduction } from '@/services/production-requirement-service'
import { getProduction } from '@/services/production-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import { paths } from '@/routes/paths'
import {
  costBreakdown, isCostEstimateComplete, missingCostNote, summarizeProductionCosts,
} from '@/domain/production-costs'
import { formatCents } from '@/domain/money'

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
  const [generating, setGenerating] = useState(false)

  const canEdit = hasModuleAccess(role, membership?.permissions ?? null, 'productions', 'edit')
  // Matching needs inventory access; the requirement itself does not.
  const canReadInventory = hasModuleAccess(role, membership?.permissions ?? null, 'inventory', 'view')

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    if (!productionId || !organization) return Promise.resolve()
    const organizationId = organization.organization_id

    async function read() {
      const production = await getProduction(productionId as string)
      if (!production) return { production, requirements: [], actions: [], items: [] }

      const [requirements, actions] = await Promise.all([
        listRequirementsForProduction({ organizationId, productionId: productionId as string }),
        listActionItemsForProduction({ organizationId, productionId: productionId as string }),
      ])

      // Matching needs inventory access; the requirement itself does not.
      const items = canReadInventory
        ? await listInventoryItems(organizationId).catch(() => [])
        : []

      return { production, requirements, actions, items }
    }

    return read().then(
      (loaded) => {
        setProduction(loaded.production)
        setRequirements(loaded.requirements)
        setActions(loaded.actions)
        setItems(loaded.items)
        setError(null)
      },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setProduction(null) },
    )
  }, [productionId, organization, canReadInventory])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(
    () => buildRequirementRows({ requirements, items, actions, teams }),
    [requirements, items, actions, teams],
  )
  const summary = summarizeProduction(rows)
  // Derived on every read from the action items themselves. Nothing about the
  // total is stored on the production, so there is no second copy to drift.
  const costs = summarizeProductionCosts(actions)

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
          <CardTitle className="text-base">Estimated cost</CardTitle>
          <CardDescription>
            Added up from this production&rsquo;s action items. Planning estimates, not what has
            been spent. Cancelled work is left out; work already done is not, because the
            production still had to pay for it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-muted-foreground text-sm">
              {isCostEstimateComplete(costs) ? 'Estimated production cost' : 'Known estimated cost'}
            </p>
            <p className="text-3xl font-semibold tabular-nums">
              {formatCents(costs.knownTotalCents)}
            </p>
          </div>

          {/* Never leave the reader to assume the total is everything: an
              unestimated action is an unknown cost, not a free one. */}
          {missingCostNote(costs) ? (
            <Alert>
              <AlertDescription>{missingCostNote(costs)}</AlertDescription>
            </Alert>
          ) : null}

          <dl className="grid gap-3 sm:grid-cols-4">
            {costBreakdown(costs).map((row) => (
              <div key={row.type} className="rounded-md border p-3">
                <dt className="text-muted-foreground text-sm">{ACTION_TYPE_LABELS[row.type]}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatCents(row.cents)}</dd>
              </div>
            ))}
          </dl>
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
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>
                  <Sparkles className="size-4" aria-hidden="true" />Draft with AI
                </Button>
                <Button size="sm" onClick={() => setEditingRequirement(null)}>
                  <Plus className="size-4" aria-hidden="true" />Add requirement
                </Button>
              </div>
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

      {generating ? (
        <Suspense fallback={null}>
          <RequirementGeneratorDialog
            production={production}
            items={items}
            canReadInventory={canReadInventory}
            existingItemNames={requirements.map((requirement) => requirement.item_name)}
            open
            onOpenChange={setGenerating}
            onSaved={load}
          />
        </Suspense>
      ) : null}

      {actioning ? (
        <ActionItemDialog
          key={actioning.requirement.requirement_id}
          requirement={actioning.requirement}
          availability={actioning.availability}
          existing={actioning.action}
          matchedUnitCostCents={
            items.find(
              (entry) => entry.item_id === actioning.requirement.inventory_item_id,
            )?.unit_cost_cents
          }
          open
          onOpenChange={(open) => { if (!open) setActioning(null) }}
          onSaved={load}
        />
      ) : null}
    </div>
  )
}
