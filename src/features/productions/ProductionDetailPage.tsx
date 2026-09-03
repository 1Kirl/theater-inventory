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
  ACTION_STATUS_LABELS, ALREADY_AVAILABLE_LABEL, PRODUCTION_STATUS_LABELS,
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
import { actionStatusTone, productionStatusTone } from '@/domain/status-tone'
import { StatusBadge } from '@/components/ui/status-badge'
import { costChart } from '@/domain/chart-projections'
import { BarList } from '@/components/charts/BarList'
import { paths } from '@/routes/paths'
import {
  isCostEstimateComplete, missingCostNote, summarizeProductionCosts,
} from '@/domain/production-costs'
import { formatCents } from '@/domain/money'

/**
 * Why the action button is dead, in the two cases where it is.
 *
 * The Action column beside it already says which case this is — an "Already
 * Available" badge, or "Not Matched" — so these are a second, quieter statement
 * for somebody who reached the button first and wants to know why it will not
 * respond. They are genuinely different reasons and must not share a message:
 * telling somebody that stock covers a requirement which was never matched to
 * any stock is worse than saying nothing.
 */
const ALREADY_AVAILABLE_HINT = 'Stock already covers this requirement.'
const NOT_MATCHED_HINT = 'Match this requirement to an inventory item first.'

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
  // Colour and order for the same numbers; no second total is computed.
  const costChartData = costChart(actions)

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

    // A requirement already covered by stock has nothing to plan, so its action
    // button used to be absent. Absent and disabled say different things: the
    // row simply lost a control its neighbours had, and the column stopped
    // lining up. It stays, and says it is unavailable.
    const satisfied = !row.action && !canCreateActionItem(row.availability)
    const hint = !satisfied
      ? undefined
      : row.availability.matched ? ALREADY_AVAILABLE_HINT : NOT_MATCHED_HINT

    return (
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" onClick={() => setEditingRequirement(row.requirement)}>Edit</Button>
        <Button
          size="sm"
          variant="outline"
          disabled={satisfied}
          onClick={() => setActioning(row)}
          title={hint}
        >
          {row.action ? 'Edit action' : 'Plan action'}
        </Button>
      </div>
    )
  }

  function ActionCell({ row }: { row: RequirementRow }) {
    if (row.action) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{actionSummary(row.action)}</Badge>
          <StatusBadge
            tone={actionStatusTone(row.action.status)}
            label={ACTION_STATUS_LABELS[row.action.status]}
          />
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
            <StatusBadge
              tone={productionStatusTone(production.status)}
              label={PRODUCTION_STATUS_LABELS[production.status]}
            />
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
        <CardContent>
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
  Planning estimates from this production&rsquo;s action items, not what has been spent.
  Cancelled work is excluded.
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

          {/*
            * The breakdown, as bars rather than four equal boxes.
            *
            * Four numbers of the same size tell you what was spent on each kind
            * of work; they do not tell you which one the budget mostly is. The
            * bar lengths do, and the figures are still written out beside them.
            *
            * Three states, because there are three things that can be true.
            *
            * Bars need a total to divide, so they are drawn only when there is
            * one. But having nothing to draw is not the same as knowing
            * nothing: work costed at exactly $0.00 is an estimate somebody
            * entered, and telling them no estimate exists — under a headline
            * already reading $0.00 — would be the interface contradicting
            * itself and inviting them to add what they had just added.
            */}
          {costChartData.hasDrawableCost ? (
            <BarList data={costChartData.rows} format={formatCents} keepZero />
          ) : costChartData.hasKnownEstimate ? (
            <div className="border-border rounded-lg border border-dashed bg-surface-sunken px-4 py-6 text-center">
              <p className="text-sm font-medium">
                Known estimated action cost: {formatCents(costChartData.knownTotalCents)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {costChartData.estimatedCount === 1
                  ? '1 action item is estimated, and it comes to nothing to spend.'
                  : `${String(costChartData.estimatedCount)} action items are estimated, `
                    + 'and they come to nothing to spend.'}
                {' '}There is no breakdown to show.
              </p>
            </div>
          ) : (
            <div className="border-border rounded-lg border border-dashed bg-surface-sunken px-4 py-6 text-center">
              <p className="text-sm font-medium">No known estimated action costs yet.</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {costChartData.unknownCount > 0
                  ? `${String(costChartData.unknownCount)} action item${costChartData.unknownCount === 1 ? '' : 's'} `
                    + `${costChartData.unknownCount === 1 ? 'has' : 'have'} no cost estimate, so there is `
                    + 'nothing to break down.'
                  : 'Add an estimate to an action item and the breakdown will appear here.'}
              </p>
            </div>
          )}
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
            requirements={requirements}
            actions={actions}
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
