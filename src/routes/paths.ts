/**
 * Route paths.
 *
 * Auth routes are public. Organization Selection and the operational shell
 * require an authenticated user; the organization and permission guards are
 * added in Phase 2 and Phase 3.
 */
export const paths = {
  // Public
  logIn: '/login',
  signUp: '/signup',

  // Authenticated, before an organization is chosen
  organizations: '/organizations',

  // Authenticated, inside the application shell
  dashboard: '/',
  inventory: '/inventory',
  maintenance: '/maintenance',
  productions: '/productions',
  actionList: '/action-list',
  calendar: '/calendar',
  team: '/team',
  organizationSettings: '/organization-settings',
  account: '/account',
} as const

export type AppPath = (typeof paths)[keyof typeof paths]
