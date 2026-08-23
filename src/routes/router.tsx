import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { AccountPage } from '@/features/auth/AccountPage'
import { LogInPage } from '@/features/auth/LogInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { CreateOrganizationPage } from '@/features/organizations/CreateOrganizationPage'
import { JoinOrganizationPage } from '@/features/organizations/JoinOrganizationPage'
import { OrganizationSelectionPage } from '@/features/organizations/OrganizationSelectionPage'
import { OrganizationSettingsPage } from '@/features/organizations/settings/OrganizationSettingsPage'
import { AdminGuard, AuthGuard, GuestGuard, OrganizationGuard } from '@/routes/guards'
import { DashboardPlaceholder } from '@/routes/DashboardPlaceholder'
import { NotFound } from '@/routes/NotFound'
import { PlaceholderPage } from '@/routes/PlaceholderPage'
import { paths } from '@/routes/paths'

/**
 * Guard chain: AuthGuard, then OrganizationGuard for anything inside an
 * organization, then AdminGuard where administration is required. Module-level
 * PermissionGuard arrives in Phase 3 and nests inside OrganizationGuard.
 */
export const router = createBrowserRouter([
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

      // Inside an organization.
      {
        element: <OrganizationGuard />,
        children: [
          {
            path: paths.dashboard,
            element: <AppShell />,
            children: [
              { index: true, element: <DashboardPlaceholder /> },
              { path: paths.account, element: <AccountPage /> },
              {
                path: paths.inventory,
                element: <PlaceholderPage title="Inventory" phase="Phase 3" />,
              },
              {
                path: paths.maintenance,
                element: <PlaceholderPage title="Maintenance & Repair" phase="Phase 4" />,
              },
              {
                path: paths.productions,
                element: <PlaceholderPage title="Productions" phase="Phase 5" />,
              },
              {
                path: paths.actionList,
                element: <PlaceholderPage title="Action List" phase="Phase 6" />,
              },
              {
                path: paths.calendar,
                element: <PlaceholderPage title="Calendar" phase="Phase 9" />,
              },
              {
                path: paths.team,
                element: <PlaceholderPage title="Team & Members" phase="Phase 3" />,
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
])
