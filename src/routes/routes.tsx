import { Navigate } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { LogInPage } from '@/features/auth/LogInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { AdminGuard, AuthGuard, GuestGuard, OrganizationGuard, PermissionGuard } from '@/routes/guards'
import { NotFound } from '@/routes/NotFound'
import { paths } from '@/routes/paths'
import {
  AccountPage,
  ActionListPage,
  CalendarPage,
  CreateOrganizationPage,
  DashboardPage,
  InventoryItemDetailPage,
  InventoryItemFormPage,
  InventoryListPage,
  InventoryUnitDetailPage,
  JoinOrganizationPage,
  MaintenanceListPage,
  MaintenanceRecordDetailPage,
  MaintenanceRecordFormPage,
  OrganizationSelectionPage,
  OrganizationSettingsPage,
  ProductionDetailPage,
  ProductionFormPage,
  ProductionListPage,
} from '@/routes/lazy-routes'

/**
 * The route tree, as data.
 *
 * Kept separate from `createBrowserRouter` so that the guard chain can be
 * asserted without a browser. One route deliberately sits outside the
 * organization guards, and a test that walks this array is what stops that
 * exception from quietly spreading to its neighbours.
 *
 * Feature pages are lazy (see `lazy-routes.ts`). The Suspense boundary lives
 * inside AppShell, so navigation and the sidebar stay on screen while a page's
 * code arrives; AuthGuard carries a second one for the routes outside the shell.
 *
 * Guard chain: AuthGuard, then OrganizationGuard for anything inside an
 * organization, then AdminGuard where administration is required. Module-level
 * PermissionGuard nests inside OrganizationGuard.
 */
export const routes: RouteObject[] = [
  {
    element: <GuestGuard />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: paths.logIn, element: <LogInPage /> },
          { path: paths.signUp, element: <SignUpPage /> },
        ],
      },
    ],
  },
  {
    element: <AuthGuard />,
    children: [
      // Before an organization is chosen.
      { path: paths.organizations, element: <OrganizationSelectionPage /> },
      { path: paths.createOrganization, element: <CreateOrganizationPage /> },
      { path: paths.joinOrganization, element: <JoinOrganizationPage /> },

      // A scanned equipment label, which is the one route that cannot be placed
      // under the active organization's guards.
      //
      // Every other page knows which organization it belongs to before it
      // loads. This one does not: a QR carries only a unit id, and which
      // organization owns that unit is a fact stored in the unit itself. Gating
      // the route on whichever organization the browser happens to have open
      // would refuse legitimate scans — somebody in two organizations, holding
      // equipment from the one that is not currently active — before the page
      // could read the unit and find out.
      //
      // Nothing is given away by moving it. Security Rules gate the read on the
      // unit's own `organization_id`, so a successful read already proves
      // membership and inventory access in the owning organization, and a
      // failed one yields a generic message with no equipment details. The
      // guard that was removed only ever decided what to render; Rules decide
      // what may be read, and they are unchanged.
      {
        element: <AppShell />,
        children: [
          { path: '/equipment/:unitId', element: <InventoryUnitDetailPage /> },
        ],
      },

      // Inside an organization.
      {
        element: <OrganizationGuard />,
        children: [
          {
            path: paths.dashboard,
            element: <AppShell />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: paths.account, element: <AccountPage /> },
              {
                element: <PermissionGuard module="inventory" level="view" />,
                children: [
                  { path: paths.inventory, element: <InventoryListPage /> },
                  {
                    element: <PermissionGuard module="inventory" level="edit" />,
                    children: [
                      { path: paths.inventoryNew, element: <InventoryItemFormPage mode="create" /> },
                      {
                        path: '/inventory/:itemId/edit',
                        element: <InventoryItemFormPage mode="edit" />,
                      },
                    ],
                  },
                  { path: '/inventory/:itemId', element: <InventoryItemDetailPage /> },
                ],
              },
              {
                element: <PermissionGuard module="maintenance" level="view" />,
                children: [
                  { path: paths.maintenance, element: <MaintenanceListPage /> },
                  {
                    element: <PermissionGuard module="maintenance" level="edit" />,
                    children: [
                      { path: paths.maintenanceNew, element: <MaintenanceRecordFormPage mode="create" /> },
                      {
                        path: '/maintenance/:recordId/edit',
                        element: <MaintenanceRecordFormPage mode="edit" />,
                      },
                    ],
                  },
                  { path: '/maintenance/:recordId', element: <MaintenanceRecordDetailPage /> },
                ],
              },
              {
                // Action List follows the productions permission; it has none of
                // its own.
                element: <PermissionGuard module="productions" level="view" />,
                children: [
                  { path: paths.productions, element: <ProductionListPage /> },
                  { path: paths.actionList, element: <ActionListPage /> },
                  {
                    element: <PermissionGuard module="productions" level="edit" />,
                    children: [
                      { path: paths.productionNew, element: <ProductionFormPage mode="create" /> },
                      { path: '/productions/:productionId/edit', element: <ProductionFormPage mode="edit" /> },
                    ],
                  },
                  { path: '/productions/:productionId', element: <ProductionDetailPage /> },
                ],
              },
              {
                // Calendar is an organization-level resource: view grants the
                // whole schedule, and team tags are only labels and filters.
                element: <PermissionGuard module="calendar" level="view" />,
                children: [{ path: paths.calendar, element: <CalendarPage /> }],
              },
              {
                // Teams, members, permissions, and administration all live in
                // Organization Settings. The old path is kept as a redirect so
                // a bookmark still lands somewhere useful.
                path: paths.team,
                element: <Navigate to={paths.organizationSettings} replace />,
              },
              {
                element: <AdminGuard />,
                children: [
                  { path: paths.organizationSettings, element: <OrganizationSettingsPage /> },
                ],
              },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]
