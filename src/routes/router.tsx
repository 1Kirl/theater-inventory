import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthLayout } from '@/features/auth/AuthLayout'
import { AccountPage } from '@/features/auth/AccountPage'
import { LogInPage } from '@/features/auth/LogInPage'
import { SignUpPage } from '@/features/auth/SignUpPage'
import { AuthGuard, GuestGuard } from '@/routes/guards'
import { DashboardPlaceholder } from '@/routes/DashboardPlaceholder'
import { NotFound } from '@/routes/NotFound'
import { OrganizationSelectionPlaceholder } from '@/routes/OrganizationSelectionPlaceholder'
import { PlaceholderPage } from '@/routes/PlaceholderPage'
import { paths } from '@/routes/paths'

/**
 * OrganizationGuard and PermissionGuard are added in Phase 2 and Phase 3; they
 * will wrap the shell routes rather than replace this structure.
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
      { path: paths.organizations, element: <OrganizationSelectionPlaceholder /> },
      {
        path: paths.dashboard,
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPlaceholder /> },
          { path: paths.account, element: <AccountPage /> },
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
    ],
  },
])
