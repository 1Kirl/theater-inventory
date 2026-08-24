import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOrganization } from '@/features/organizations/useOrganization'
import { dashboardAccess, type DashboardAccess } from '@/features/dashboard/dashboard-summary'
import {
  loadDashboard, type DashboardLoaders, type ProductionsData,
} from '@/features/dashboard/dashboard-loader'
import { listInventoryItems } from '@/services/inventory-service'
import { listMaintenanceRecords } from '@/services/maintenance-service'
import { listProductions } from '@/services/production-service'
import { listRequirements } from '@/services/production-requirement-service'
import { listActionItems } from '@/services/action-item-service'
import { listCalendarEvents } from '@/services/calendar-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { CalendarEvent } from '@/types/calendar'

/**
 * Dashboard reads, one module at a time.
 *
 * Two rules shape this. A module the user cannot view is never requested — not
 * requested and hidden, not requested and discarded — so an unauthorized read is
 * not something Security Rules have to refuse on the dashboard's behalf. And
 * each module carries its own state, so maintenance failing leaves the inventory
 * card standing.
 */

export type ModuleState<T> =
  | { status: 'skipped' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string }

export type { ProductionsData }

export interface DashboardData {
  access: DashboardAccess
  inventory: ModuleState<InventoryItem[]>
  maintenance: ModuleState<MaintenanceRecord[]>
  productions: ModuleState<ProductionsData>
  calendar: ModuleState<CalendarEvent[]>
  reload: () => void
}

const SKIPPED = { status: 'skipped' } as const

const LOADERS: DashboardLoaders = {
  inventory: listInventoryItems,
  maintenance: listMaintenanceRecords,
  productions: async (organizationId) => {
    const [productions, requirements, actions] = await Promise.all([
      listProductions(organizationId),
      listRequirements(organizationId),
      listActionItems(organizationId),
    ])
    return { productions, requirements, actions }
  },
  calendar: listCalendarEvents,
}

export function useDashboardData(): DashboardData {
  const { organization, membership, role } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const access = useMemo(
    () => dashboardAccess(role, membership?.permissions ?? null),
    [role, membership?.permissions],
  )

  const [inventory, setInventory] = useState<ModuleState<InventoryItem[]>>(SKIPPED)
  const [maintenance, setMaintenance] = useState<ModuleState<MaintenanceRecord[]>>(SKIPPED)
  const [productions, setProductions] = useState<ModuleState<ProductionsData>>(SKIPPED)
  const [calendar, setCalendar] = useState<ModuleState<CalendarEvent[]>>(SKIPPED)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    if (!organizationId) return

    const setters = {
      inventory: setInventory as (state: ModuleState<unknown>) => void,
      maintenance: setMaintenance as (state: ModuleState<unknown>) => void,
      productions: setProductions as (state: ModuleState<unknown>) => void,
      calendar: setCalendar as (state: ModuleState<unknown>) => void,
    }

    // Every module is reset first, so switching organizations cannot leave the
    // previous one's records on screen while the new reads are in flight.
    for (const module of ['inventory', 'maintenance', 'productions', 'calendar'] as const) {
      setters[module](access[module] ? { status: 'loading' } : SKIPPED)
    }

    let cancelled = false

    void loadDashboard({
      organizationId,
      access,
      loaders: LOADERS,
      onSettled: ({ module, result }) => {
        if (cancelled) return
        setters[module](
          result.ok
            ? { status: 'ready', data: result.data }
            : { status: 'error', message: toOrganizationErrorMessage(result.error) },
        )
      },
    })

    return () => { cancelled = true }
  }, [organizationId, access, reloadToken])

  return { access, inventory, maintenance, productions, calendar, reload }
}
