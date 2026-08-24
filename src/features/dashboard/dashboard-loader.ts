import type { DashboardAccess } from '@/features/dashboard/dashboard-summary'
import type { InventoryItem } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import type { CalendarEvent } from '@/types/calendar'

/**
 * Which reads the dashboard performs, decided before any of them run.
 *
 * A module the user cannot view is never requested. Not requested and hidden,
 * not requested and discarded — never requested. Security Rules would refuse it
 * anyway, but a refusal is a request that should not have been made, and the
 * dashboard is the one screen tempted to ask for everything at once.
 *
 * The loaders are injected so this can be tested without a browser or a
 * network, including the part that matters most: that an unauthorized loader is
 * never called.
 */

export type DashboardModule = 'inventory' | 'maintenance' | 'productions' | 'calendar'

export interface ProductionsData {
  productions: Production[]
  requirements: ProductionRequirement[]
  actions: ActionItem[]
}

export interface DashboardLoaders {
  inventory: (organizationId: string) => Promise<InventoryItem[]>
  maintenance: (organizationId: string) => Promise<MaintenanceRecord[]>
  productions: (organizationId: string) => Promise<ProductionsData>
  calendar: (organizationId: string) => Promise<CalendarEvent[]>
}

/** The modules that will actually be read, in a stable order. */
export function fetchPlan(access: DashboardAccess): DashboardModule[] {
  const modules: DashboardModule[] = ['inventory', 'maintenance', 'productions', 'calendar']
  return modules.filter((module) => access[module])
}

export interface ModuleOutcome {
  module: DashboardModule
  result: { ok: true; data: unknown } | { ok: false; error: unknown }
}

/**
 * Run the planned reads, reporting each as it settles.
 *
 * Each module is reported on its own, so one failing leaves the others to
 * arrive. Nothing here throws: a rejected read becomes an outcome.
 */
export async function loadDashboard(params: {
  organizationId: string
  access: DashboardAccess
  loaders: DashboardLoaders
  onSettled: (outcome: ModuleOutcome) => void
}): Promise<void> {
  const planned = fetchPlan(params.access)

  await Promise.all(planned.map(async (module) => {
    try {
      const data = await params.loaders[module](params.organizationId)
      params.onSettled({ module, result: { ok: true, data } })
    } catch (error) {
      params.onSettled({ module, result: { ok: false, error } })
    }
  }))
}
