import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPlaceholder } from '@/routes/DashboardPlaceholder'
import { NotFound } from '@/routes/NotFound'
import { PlaceholderPage } from '@/routes/PlaceholderPage'
import { paths } from '@/routes/paths'

/**
 * Phase 0 routing. The guard chain (AuthGuard, OrganizationGuard,
 * AssignmentGuard, PermissionGuard) is introduced from Phase 1 onward and will
 * wrap these routes rather than replace them.
 */
export const router = createBrowserRouter([
  {
    path: paths.dashboard,
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPlaceholder /> },
      {
        path: paths.inventory,
        element: <PlaceholderPage title="Inventory" phase="Phase 4" />,
      },
      {
        path: paths.maintenance,
        element: <PlaceholderPage title="Maintenance & Repair" phase="Phase 5" />,
      },
      {
        path: paths.productions,
        element: <PlaceholderPage title="Productions" phase="Phase 6" />,
      },
      {
        path: paths.actionList,
        element: <PlaceholderPage title="Action List" phase="Phase 7" />,
      },
      {
        path: paths.calendar,
        element: <PlaceholderPage title="Calendar" phase="Phase 10" />,
      },
      {
        path: paths.team,
        element: <PlaceholderPage title="Team & Members" phase="Phase 3" />,
      },
      {
        path: paths.organizationSettings,
        element: <PlaceholderPage title="Organization Settings" phase="Phase 11" />,
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
