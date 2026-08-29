import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, ScanLine, Search } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useOrganization } from '@/features/organizations/useOrganization'
import type { SmartSearchResult } from '@/features/ai/smart-search'

/**
 * The AI panel carries the Firebase AI SDK with it, so it is fetched as its own
 * chunk rather than travelling with the inventory page. The list, the search,
 * and the filters render and work while it arrives — and if it never arrives,
 * they still do.
 */
const SmartSearchPanel = lazy(() => import('@/features/ai/SmartSearchPanel')
  .then((m) => ({ default: m.SmartSearchPanel })))
import { hasModuleAccess } from '@/domain/module-access'
import { CONDITION_KEYS, CONDITION_LABELS } from '@/domain/inventory'
import {
  EMPTY_FILTERS,
  conditionSummaryLabel,
  conditionTone,
  filterInventoryItems,
  teamNameOf,
  type InventoryFilters,
} from '@/features/inventory/inventory-view'
import { itemPresentation, unitBreakdownLine } from '@/features/inventory/inventory-unit-view'
import { listInventoryItems } from '@/services/inventory-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { INVENTORY_CATEGORIES, type InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

function ConditionBadge({ item }: { item: InventoryItem }) {
  const tone = conditionTone(item)
  return (
    <Badge
      variant={tone === 'destructive' ? 'destructive' : tone === 'neutral' ? 'secondary' : 'outline'}
    >
      {conditionSummaryLabel(item)}
    </Badge>
  )
}

function formatDate(item: InventoryItem): string {
  const stamp = item.last_inspected_at
  if (!stamp) return 'Never'
  return stamp.toDate().toLocaleDateString()
}

export function InventoryListPage() {
  const navigate = useNavigate()
  const { organization, membership, role, teams } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const [items, setItems] = useState<InventoryItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<InventoryFilters>(EMPTY_FILTERS)
  // The AI answer and the records it named. While one is active the list shows
  // those records; the manual filters still apply on top, so the user can
  // narrow an AI answer or drop out of it entirely.
  const [aiSearch, setAiSearch] = useState<SmartSearchResult | null>(null)

  const canCreate = hasModuleAccess(role, membership?.permissions ?? null, 'inventory', 'edit')

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    if (!organizationId) return Promise.resolve()

    return listInventoryItems(organizationId).then(
      (loaded) => { setItems(loaded); setError(null) },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setItems([]) },
    )
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (!items) return []
    // An AI answer narrows the set to the records it named; the manual filters
    // are then applied to those, so both controls keep working together.
    const base = aiSearch && aiSearch.items.length > 0 ? aiSearch.items : items
    return filterInventoryItems(base, filters, teams)
  }, [items, filters, teams, aiSearch])

  function setFilter<K extends keyof InventoryFilters>(key: K, value: InventoryFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS)
    setAiSearch(null)
  }

  const filtersActive =
    aiSearch !== null || JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground text-sm">
            Everything this organization owns. Editing is limited to your own teams.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Scanning is a way in, never the only one: search and the list
              below stay exactly as they were. */}
          <Button asChild size="sm" variant="outline">
            <Link to={paths.scanner}>
              <ScanLine className="size-4" aria-hidden="true" />
              Scan equipment
            </Link>
          </Button>
          {canCreate ? (
            <Button asChild size="sm">
              <Link to={paths.inventoryNew}>
                <Plus className="size-4" aria-hidden="true" />
                Add item
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Suspense fallback={<div className="bg-muted/40 h-32 animate-pulse rounded-xl" aria-hidden="true" />}>
        <SmartSearchPanel
          items={items ?? []}
          teams={teams}
          active={aiSearch}
          onAnswer={(result) => {
            setAiSearch(result)
            // The interpreted filters, when the model produced them, go into the
            // ordinary controls so the user can keep working deterministically.
            setFilters(result.resolved?.filters ?? EMPTY_FILTERS)
          }}
          onClear={clearAll}
        />
      </Suspense>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={filters.text}
              onChange={(event) => setFilter('text', event.target.value)}
              placeholder="Search name, category, location, notes"
              className="pl-9"
              aria-label="Search inventory"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={filters.category} onValueChange={(value) => setFilter('category', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {INVENTORY_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
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
              <Label className="text-xs">Condition</Label>
              <Select value={filters.condition} onValueChange={(value) => setFilter('condition', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any condition</SelectItem>
                  {CONDITION_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>{CONDITION_LABELS[key]}</SelectItem>
                  ))}
                  <SelectItem value="unclassified">Unclassified</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Availability</Label>
              <Select
                value={filters.availability}
                onValueChange={(value) => setFilter('availability', value)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any availability</SelectItem>
                  <SelectItem value="available">Some available</SelectItem>
                  <SelectItem value="unavailable">None available</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {aiSearch ? (
            <p className="text-muted-foreground text-xs">
              These filters narrow the AI's results. Clear the AI answer above to search everything
              again.
            </p>
          ) : null}

          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}

      {items === null ? (
        <p className="text-muted-foreground text-sm">Loading inventory…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium">No inventory items have been added yet.</p>
            <p className="text-muted-foreground text-sm">
              {canCreate
                ? 'Add your first item to start tracking what the organization owns.'
                : 'Someone with edit access can add the first item.'}
            </p>
            {canCreate ? (
              <Button asChild size="sm"><Link to={paths.inventoryNew}>Add item</Link></Button>
            ) : null}
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">
              No items match these filters. Try clearing them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop: a table, because comparing quantities across rows is the point. */}
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Last inspected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow
                    key={item.item_id}
                    className="cursor-pointer"
                    onClick={() => navigate(paths.inventoryItem(item.item_id))}
                  >
                    <TableCell className="font-medium">
                      {/* The row click is a convenience; this link is what makes
                          the row reachable by keyboard and to a screen reader. */}
                      <Link
                        to={paths.inventoryItem(item.item_id)}
                        className="hover:underline focus-visible:underline focus-visible:outline-none"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {item.name}
                      </Link>
                      {aiSearch?.reasons.get(item.item_id) ? (
                        <span className="text-muted-foreground block text-xs font-normal">
                          {aiSearch.reasons.get(item.item_id)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.category}</TableCell>
                    {/* Team, location, and inspection describe one physical
                        thing. A serialized item is a grouping of many, each
                        with its own, so a single value here would be a claim
                        about equipment it does not describe. */}
                    <TableCell className="text-muted-foreground">
                      {itemPresentation(item).showsParentTeam ? teamNameOf(item, teams) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity_available}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity_total}</TableCell>
                    <TableCell><ConditionBadge item={item} /></TableCell>
                    <TableCell className="text-muted-foreground">
                      {itemPresentation(item).showsParentLocation ? (
                        item.location
                      ) : (
                        <Badge variant="outline">{itemPresentation(item).badge}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {itemPresentation(item).showsParentInspection ? formatDate(item) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards, showing what a technician checks first. */}
          <ul className="space-y-3 md:hidden">
            {visible.map((item) => (
              <li key={item.item_id}>
                <Link to={paths.inventoryItem(item.item_id)} className="block">
                  <Card>
                    <CardContent className="space-y-2 pt-6">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1 font-medium">{item.name}</span>
                        <ConditionBadge item={item} />
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {item.category}
                        {itemPresentation(item).showsParentTeam ? ` · ${teamNameOf(item, teams)}` : ''}
                      </p>
                      <p className="text-sm tabular-nums">
                        {item.quantity_available} of {item.quantity_total} available
                      </p>
                      {itemPresentation(item).showsLifecycleSummary ? (
                        <>
                          <Badge variant="outline">{itemPresentation(item).badge}</Badge>
                          <p className="text-muted-foreground text-xs tabular-nums">
                            {unitBreakdownLine(item)}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground text-xs">{item.location}</p>
                      )}
                      {aiSearch?.reasons.get(item.item_id) ? (
                        <p className="text-muted-foreground text-xs italic">
                          {aiSearch.reasons.get(item.item_id)}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground text-xs">
            {visible.length} of {items.length} item{items.length === 1 ? '' : 's'}
          </p>
        </>
      )}
    </div>
  )
}
