import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CalendarDays, Package, Plus, Theater, Wrench } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { hasModuleAccess } from '@/domain/module-access'
import { MAINTENANCE_STATUS_LABELS, isOverdue } from '@/domain/maintenance'
import { PRODUCTION_STATUS_LABELS } from '@/domain/production'
import { formatEventTime, isAllDay } from '@/domain/calendar'
import { itemNameById } from '@/features/maintenance/maintenance-view'
import { audienceLabel } from '@/features/calendar/calendar-view'
import {
  hasAnyAccess, summarizeInventory, summarizeMaintenance, summarizeProductions, upcomingEvents,
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

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/** A contained failure. One module going down does not take the page with it. */
function ModuleError({ label, message }: { label: string; message: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
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
      <CardContent className="pt-6">
        <p className="text-muted-foreground text-sm">Loading {label}…</p>
      </CardContent>
    </Card>
  )
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
  const maintenanceSummary = records ? summarizeMaintenance(records, now) : null
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
  const upcoming = events ? upcomingEvents(events, now) : null

  if (!hasAnyAccess(data.access)) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{organization?.name}</h1>
        <Card>
          <CardContent className="space-y-2 pt-6">
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
              <Button key={action.to} asChild size="sm" variant="outline">
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
              label="Active productions"
              value={String(productionsSummary.activeCount)}
              hint={
                productionsSummary.shortageCount === null
                  ? 'Shortages need inventory access'
                  : `${productionsSummary.shortageCount} requirement${productionsSummary.shortageCount === 1 ? '' : 's'} short`
              }
            />
            <Metric
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
        {upcoming ? (
          <Metric
            label="Upcoming events"
            value={String(upcoming.length)}
            hint={upcoming.length === 0 ? 'Nothing scheduled from today' : 'From today onward'}
          />
        ) : null}
      </div>

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
                          <Badge variant="default">
                            {PRODUCTION_STATUS_LABELS[row.production.status]}
                          </Badge>
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
                          <Badge variant="secondary">
                            {MAINTENANCE_STATUS_LABELS[record.status]}
                          </Badge>
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

        {upcoming ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Upcoming events
                  </CardTitle>
                  <CardDescription>From today onward.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link to={paths.calendar}>Open calendar</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing is scheduled.
                  {canAddEvent ? ' Add a rehearsal or a build day.' : ''}
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {upcoming.map((event) => (
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
                </>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
