import { Navigate } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { LogInPage } from '@/features/auth/LogInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import {
  AdminGuard, AuthGuard, GuestGuard, LandingGate, MembershipGuard, OrganizationGuard,
  PermissionGuard,
} from '@/routes/guards'
import { NotFound } from '@/routes/NotFound'
import { paths } from '@/routes/paths'
import {
  AccountPage,
  ActionListPage,
  CalendarPage,
  ContactsPage,
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
  ScannerPage,
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

      // The two scanned labels, which are the routes that cannot be placed under
      // the active organization's guards.
      //
      // Every other page knows which organization it belongs to before it
      // loads. These do not: a QR carries only a document id, and which
      // organization owns it is a fact stored in the record itself. Gating the
      // route on whichever organization the browser happens to have open would
      // refuse legitimate scans — somebody in two organizations, holding
      // equipment from the one that is not currently active — before the page
      // could read the record and find out.
      //
      // The item route joined the unit route here in Phase 11I, when bulk items
      // got labels of their own. Leaving it inside the guards meant its guards
      // were evaluated against the wrong organization: a person with inventory
      // access in A, browsing B, was refused by B's PermissionGuard for a record
      // A had already authorized. Two label types with different cross-
      // organization behavior is a worse answer than one shared resolver.
      //
      // Nothing is given away by moving them. Security Rules gate each read on
      // the record's own `organization_id`, so a successful read already proves
      // membership and inventory access in the owning organization, and a failed
      // one yields a generic message with no record details. The guards that
      // were removed only ever decided what to render; Rules decide what may be
      // read, and they are unchanged. `resolveDeepLink` reconstructs the render
      // boundary in the page, before any detail is shown.
      {
        element: <AppShell />,
        children: [
          { path: '/equipment/:unitId', element: <InventoryUnitDetailPage /> },
          { path: '/inventory/:itemId', element: <InventoryItemDetailPage /> },
        ],
      },

      // The organization directory, which asks only for an active membership.
      //
      // Knowing who is on your crew is not a module permission, and somebody
      // waiting for an assignment is still a member. It keeps the shell, so the
      // header and its profile control come with it; the sidebar shows them
      // nothing they cannot open.
      {
        element: <MembershipGuard />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: paths.contacts, element: <ContactsPage /> },
            ],
          },
        ],
      },
    ],
  },

  // The root path, and the application that lives beneath it.
  //
  // Split out of the AuthGuard branch above for one reason: `/` is public now.
  // LandingGate has to sit *above* AuthGuard, because AuthGuard's job is to
  // send a signed-out visitor to the log-in form and that is exactly what must
  // not happen at the root. Everything below it is the tree that was here
  // before, unmoved and unchanged — same guards in the same order, and one
  // AppShell instance shared by every module page, so navigating between them
  // still does not remount the shell.
  //
  // The dashboard keeps `/`. It is where organization selection sends somebody
  // after they pick an organization, so redirecting a signed-in visitor away
  // from `/` would send them straight back to selection and round again.
  {
    element: <LandingGate />,
    children: [
      {
        element: <AuthGuard />,
        children: [
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
                      // Deliberately inside the current organization's guards,
                      // unlike the equipment deep link: a scanning session is
                      // opened in one organization on purpose.
                      { path: paths.scanner, element: <ScannerPage /> },
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
    ],
  },
]
