import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CalendarDays, ListChecks, Package, PackageOpen, Plus, Theater, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { hasModuleAccess } from '@/domain/module-access'
import { MAINTENANCE_STATUS_LABELS, isOverdue } from '@/domain/maintenance'
import { PRODUCTION_STATUS_LABELS } from '@/domain/production'
import {
  maintenanceStatusTone, productionStatusTone, type StatusTone,
} from '@/domain/status-tone'
import {
  categoryChart, lifecycleChart, type LifecycleChart,
} from '@/domain/chart-projections'
import { DonutChart } from '@/components/charts/DonutChart'
import { ChartLegend } from '@/components/charts/ChartLegend'
import { BarList } from '@/components/charts/BarList'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatEventTime, isAllDay } from '@/domain/calendar'
import { itemNameById } from '@/features/maintenance/maintenance-view'
import { audienceLabel } from '@/features/calendar/calendar-view'
import {
  hasAnyAccess, summarizeCalendar, summarizeInventory, summarizeMaintenance, summarizeProductions,
} from '@/features/dashboard/dashboard-summary'
import { useDashboardData, type ModuleState } from '@/features/dashboard/useDashboardData'
import { paths } from '@/routes/paths'

/**
 * The operations overview from IA section 4.1.
 *
 * Every figure is derived from records read for this request; nothing is stored
 * and nothing is duplicated. Each card belongs to the module it summarizes and
 * is absent — not empty, not zero, not an error — when that module is not
 * viewable, per DESIGN_SYSTEM section 14.
 */

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/**
 * One headline number.
 *
 * The icon sits on a tinted square tied to the module it belongs to. It is
 * decoration in the strict sense — the label beside it already says what the
 * number is — so it is hidden from assistive technology and nothing depends on
 * telling the tints apart.
 */
function Metric({
  label, value, hint, icon: Icon, tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: StatusTone
}) {
  return (
    // The grid stretches every card to the tallest in its row, and the content
    // used to sit at the top of that height with the surplus below it — read as
    // bottom-heavy, though the real fault was the group not being centred at
    // all. `flex-1` claims the stretched height and `justify-center` puts the
    // whole cluster in the middle of it, so a card with a two-line hint and a
    // card with none still look like the same card.
    //
    // The symmetric `py-2` replaces a `pt-6` that had no `pb` to match it: the
    // card's own padding is even, and adding to one side only was the other
    // half of the imbalance.
    <Card className="h-full">
      <CardContent className="flex flex-1 flex-col justify-center py-2">
        <div className="flex items-start gap-3">
          {Icon ? (
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg"
              style={{
                color: `var(--tone-${tone})`,
                backgroundColor: `color-mix(in oklab, var(--tone-${tone}) 12%, transparent)`,
              }}
              aria-hidden="true"
            >
              <Icon className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0 space-y-0.5">
            <p className="text-muted-foreground text-xs">{label}</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
            {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** A contained failure. One module going down does not take the page with it. */
function ModuleError({ label, message }: { label: string; message: string }) {
  return (
    <Card>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium">{label}</p>
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{message}</AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-muted-foreground text-sm">Loading {label}…</p>
      </CardContent>
    </Card>
  )
}

/**
 * What the ring says, in words.
 *
 * The drawing itself is `aria-label`led with this, so the chart is never the
 * only way to learn the numbers. Zero-count states are left out of the sentence
 * but stay visible in the legend beside it.
 */
function lifecycleSummaryText(chart: LifecycleChart): string {
  const parts = chart.slices
    .filter((slice) => slice.value > 0)
    .map((slice) => `${slice.label}: ${String(slice.value)}`)

  return parts.length === 0
    ? 'Equipment status: no individually tracked units.'
    : `Equipment status, ${String(chart.total)} units in total. ${parts.join('. ')}.`
}

/** True only when the module was requested and came back. */
function ready<T>(state: ModuleState<T>): T | null {
  return state.status === 'ready' ? state.data : null
}

export function DashboardPage() {
  const { organization, membership, role, teams } = useOrganization()
  const data = useDashboardData()
  const permissions = membership?.permissions ?? null

  const canAddInventory = hasModuleAccess(role, permissions, 'inventory', 'edit')
  const canAddProduction = hasModuleAccess(role, permissions, 'productions', 'edit')
  const canAddEvent = hasModuleAccess(role, permissions, 'calendar', 'edit')

  const now = useMemo(() => new Date(), [])

  const items = ready(data.inventory)
  const records = ready(data.maintenance)
  const production = ready(data.productions)
  const events = ready(data.calendar)

  const inventorySummary = items ? summarizeInventory(items) : null
  // Serialized items are passed in so their own unit counts, rather than the
  // repair records, are what says how much equipment is away.
  const maintenanceSummary = records
    ? summarizeMaintenance(records, now, 5, items ?? [])
    : null
  const productionsSummary = production
    ? summarizeProductions({
      productions: production.productions,
      requirements: production.requirements,
      actions: production.actions,
      // Shortage is measured against inventory. Without inventory access there
      // is nothing to measure against, and the summary says so rather than
      // reporting zero.
      items: items ?? [],
      canReadInventory: data.access.inventory && items !== null,
    })
    : null
  const calendarSummary = events ? summarizeCalendar(events, now) : null

  // Both charts read the inventory the page already loaded, through the same
  // helpers the cards above use. Neither computes a figure of its own.
  const lifecycle = items ? lifecycleChart(items) : null
  const categories = items ? categoryChart(items) : null

  if (!hasAnyAccess(data.access)) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{organization?.name}</h1>
        <Card>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">Nothing to show yet.</p>
            <p className="text-muted-foreground text-sm">
              Your Admin has not given you access to any module in this organization. Ask them to
              assign a team and the permissions you need.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // One treatment for all three. Adding an item, a production, and an event are
  // the same kind of act, and giving each its own colour turned a row of
  // related buttons into three unrelated ones. The colour lives in
  // `.quick-action` in the stylesheet; this list is about what they do.
  const quickActions = [
    canAddInventory ? { label: 'Add item', to: paths.inventoryNew } : null,
    canAddProduction ? { label: 'Add production', to: paths.productionNew } : null,
    canAddEvent ? { label: 'Add calendar event', to: `${paths.calendar}?new=1` } : null,
  ].filter((action) => action !== null)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{organization?.name}</h1>
          <p className="text-muted-foreground text-sm">
            What this organization owns, what is out for repair, and what is coming up.
          </p>
        </div>
        {quickActions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Button key={action.to} asChild size="sm" variant="outline" className="quick-action">
                <Link to={action.to}>
                  <Plus className="size-4" aria-hidden="true" />
                  {action.label}
                </Link>
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Summary cards. Each one is present only when its module is viewable. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.inventory.status === 'loading' ? <Loading label="inventory" /> : null}
        {data.inventory.status === 'error' ? (
          <ModuleError label="Inventory" message={data.inventory.message} />
        ) : null}
        {inventorySummary ? (
          <Metric
            icon={Package}
            tone="info"
            label="Total inventory records"
            value={String(inventorySummary.itemCount)}
            hint={`${inventorySummary.availableUnits} of ${inventorySummary.totalUnits} units available`}
          />
        ) : null}

        {data.maintenance.status === 'loading' ? <Loading label="maintenance" /> : null}
        {data.maintenance.status === 'error' ? (
          <ModuleError label="Maintenance" message={data.maintenance.message} />
        ) : null}
        {maintenanceSummary ? (
          <>
            <Metric
              icon={Wrench}
              tone={maintenanceSummary.overdueCount > 0 ? 'caution' : 'warning'}
              label="Active Repairs"
              value={String(maintenanceSummary.openCount)}
              hint={
                maintenanceSummary.overdueCount > 0
                  ? `${maintenanceSummary.overdueCount} past the expected return date`
                  // Spelled out because "active" means something narrower in the
                  // maintenance module itself: this count includes a repair that
                  // has been logged but not yet sent.
                  : 'Repairs that are planned or still open'
              }
            />
            <Metric
              icon={PackageOpen}
              tone="warning"
              label="Currently in service"
              value={String(maintenanceSummary.inServiceQuantity)}
              hint="Units sent, in service, or ready"
            />
          </>
        ) : null}

        {data.productions.status === 'loading' ? <Loading label="productions" /> : null}
        {data.productions.status === 'error' ? (
          <ModuleError label="Productions" message={data.productions.message} />
        ) : null}
        {productionsSummary ? (
          <>
            <Metric
              icon={Theater}
              tone="planned"
              label="Active productions"
              value={String(productionsSummary.activeCount)}
              hint={
                productionsSummary.shortageCount === null
                  ? 'Shortages need inventory access'
                  : `${productionsSummary.shortageCount} requirement${productionsSummary.shortageCount === 1 ? '' : 's'} short`
              }
            />
            <Metric
              icon={ListChecks}
              tone="info"
              label="Unresolved actions"
              value={String(productionsSummary.openActionCount)}
              hint="To do or in progress"
            />
          </>
        ) : null}

        {data.calendar.status === 'loading' ? <Loading label="calendar" /> : null}
        {data.calendar.status === 'error' ? (
          <ModuleError label="Calendar" message={data.calendar.message} />
        ) : null}
        {calendarSummary ? (
          <Metric
            icon={CalendarDays}
            tone="ready"
            label="Upcoming events"
            value={String(calendarSummary.upcomingCount)}
            hint={
              calendarSummary.upcomingCount === 0
                ? 'Nothing scheduled from today'
                : 'From today onward'
            }
          />
        ) : null}
      </div>

      {/*
        * Two charts, deliberately. They answer questions the numbers above
        * cannot — what state the equipment is in, and what the inventory is
        * made of — rather than redrawing a figure that is already on the page.
        */}
      {lifecycle && categories ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Equipment status</CardTitle>
              <CardDescription>
                Individually tracked equipment only. Bulk quantities are not units and are
                not counted here.
              </CardDescription>
            </CardHeader>
            {/*
              * A vertical composition: the ring first, at a size that makes it
              * the thing you look at, and the figures underneath it.
              *
              * It used to sit beside its legend, which cost the ring most of the
              * card's width and left the legend fighting for the rest — on a
              * phone that fight is what pushed "Unusable, on hand" off the edge.
              * Stacking gives the ring the full width to be centred in and gives
              * the legend the full width to lay out in, and it is the same
              * arrangement at every size, so there is no width at which the two
              * layouts disagree.
              *
              * The ring and its legend are one group, and the group is what
              * gets centred — not the ring, and not the legend, each finding
              * its own position in the body.
              *
              * The distinction is visible when the row stretches this card to
              * match the category list beside it. Centring two siblings spreads
              * the surplus around each of them; centring one container puts the
              * whole composition's middle at the body's middle, which is what
              * the eye actually measures.
              *
              * On a narrow screen the grid is one column, the card's height is
              * whatever the content needs, and there is no surplus for
              * `justify-center` to place. Mobile stays content-driven without a
              * second layout to maintain.
              */}
            <CardContent className="flex flex-1 flex-col justify-center">
              {lifecycle.serializedItemCount === 0 ? (
                <div className="border-border flex w-full flex-col items-center gap-2 rounded-lg border border-dashed bg-surface-sunken px-4 py-8 text-center">
                  <Package className="text-muted-foreground size-5" aria-hidden="true" />
                  <p className="text-sm font-medium">No individually tracked equipment yet</p>
                  <p className="text-muted-foreground text-xs">
                    Items tracked as a bulk quantity have no per-unit status to chart.
                  </p>
                </div>
              ) : (
                // One container, so the ring and the figures that explain it
                // move together. The gap is small on purpose: they are one
                // statement, and a wide gap would read as two.
                <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4">
                  <DonutChart
                    data={lifecycle.slices}
                    centerValue={String(lifecycle.activeTotal)}
                    centerLabel="active"
                    summary={lifecycleSummaryText(lifecycle)}
                    size={184}
                  />
                  {/* One column at every width. The block is centred; the rows
                      are not centred individually — marker, label and count each
                      keep their column, so the six numbers line up under one
                      another and can be read straight down. */}
                  <ChartLegend data={lifecycle.slices} className="w-full" />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Inventory by category</CardTitle>
              <CardDescription>
                Counted in things currently held — a maintained quantity for bulk items, active
                units for serialized ones. Retired equipment is excluded.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {categories.rows.length === 0 ? (
                <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed bg-surface-sunken px-4 py-8 text-center">
                  <Package className="text-muted-foreground size-5" aria-hidden="true" />
                  <p className="text-sm font-medium">Nothing in the inventory yet</p>
                  <p className="text-muted-foreground text-xs">
                    Add an item and its category will appear here.
                  </p>
                </div>
              ) : (
                <>
                  <BarList data={categories.rows} format={String} />
                  <p className="text-muted-foreground mt-4 text-xs tabular-nums">
                    {categories.total} in total across {categories.itemCount} record
                    {categories.itemCount === 1 ? '' : 's'}.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {productionsSummary ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Theater className="size-4" aria-hidden="true" />
                    Active productions
                  </CardTitle>
                  <CardDescription>Requirements and open actions, counted live.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={paths.productions}>All productions</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {productionsSummary.active.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No production is active right now.
                  {canAddProduction ? ' Add one when the season starts.' : ''}
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {productionsSummary.active.map((row) => (
                    <li key={row.production.production_id}>
                      <Link
                        to={paths.production(row.production.production_id)}
                        className="hover:bg-accent/40 focus-visible:ring-ring block rounded-sm py-3 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {row.production.title}
                          </span>
                          <StatusBadge
                            tone={productionStatusTone(row.production.status)}
                            label={PRODUCTION_STATUS_LABELS[row.production.status]}
                          />
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                          {row.requirementCount} requirement{row.requirementCount === 1 ? '' : 's'}
                          {row.shortageCount === null
                            ? ' · shortages need inventory access'
                            : ` · ${row.shortageCount} short`}
                          {' · '}
                          {row.openActionCount} open action{row.openActionCount === 1 ? '' : 's'}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {maintenanceSummary ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Wrench className="size-4" aria-hidden="true" />
                    Recent repairs
                  </CardTitle>
                  <CardDescription>The most recently logged records.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={paths.maintenance}>All repairs</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {maintenanceSummary.recent.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing has been sent for repair yet.
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {maintenanceSummary.recent.map((record) => (
                    <li key={record.maintenance_id}>
                      <Link
                        to={paths.maintenanceRecord(record.maintenance_id)}
                        className="hover:bg-accent/40 focus-visible:ring-ring block rounded-sm py-3 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {items ? itemNameById(record.item_id, items) : record.issue_description}
                          </span>
                          <StatusBadge
                            tone={maintenanceStatusTone(record.status)}
                            label={MAINTENANCE_STATUS_LABELS[record.status]}
                          />
                          {isOverdue(record, now) ? (
                            <Badge variant="destructive">
                              <AlertTriangle className="size-3" aria-hidden="true" />
                              Overdue
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
                          {record.quantity_sent} sent · {record.issue_description}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {calendarSummary ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Upcoming events
                  </CardTitle>
                  <CardDescription>
                    {calendarSummary.upcomingCount > calendarSummary.preview.length
                      ? `The next ${calendarSummary.preview.length} of ${calendarSummary.upcomingCount}.`
                      : 'From today onward.'}
                  </CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={paths.calendar}>Open calendar</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {calendarSummary.preview.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing is scheduled.
                  {canAddEvent ? ' Add a rehearsal or a build day.' : ''}
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {calendarSummary.preview.map((event) => (
                    <li key={event.event_id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {DATE_FORMAT.format(event.event_date.toDate())}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
                        <Badge variant="outline">{event.event_type}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {isAllDay(event) ? 'All day' : formatEventTime(event)}
                        {' · '}
                        {audienceLabel(event, teams)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {inventorySummary ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="size-4" aria-hidden="true" />
                    Inventory condition
                  </CardTitle>
                  <CardDescription>Derived from each item's condition counts.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={paths.inventory}>Open inventory</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {inventorySummary.itemCount === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No inventory has been added yet.
                  {canAddInventory ? ' Add the first item to start tracking.' : ''}
                </p>
              ) : (
                <>
                  <p className="text-sm tabular-nums">
                    {inventorySummary.needsAttentionCount} of {inventorySummary.itemCount} item
                    {inventorySummary.itemCount === 1 ? '' : 's'} are mostly needing repair or
                    unusable.
                  </p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {inventorySummary.availableUnits} of {inventorySummary.totalUnits} units are
                    marked available.
                  </p>
                  {/* Only individually tracked equipment can go missing: a bulk
                      quantity has no piece to lose. Counted from the item
                      summaries already loaded here. */}
                  {inventorySummary.lostUnits > 0 ? (
                    <p className="text-sm font-medium tabular-nums">
                      {inventorySummary.lostUnits} piece
                      {inventorySummary.lostUnits === 1 ? ' of equipment is' : 's of equipment are'}
                      {' '}currently lost.
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
