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
  createOrganization: '/organizations/create',
  joinOrganization: '/organizations/join',

  // Authenticated, inside the application shell
  dashboard: '/',
  inventory: '/inventory',
  inventoryNew: '/inventory/new',
  inventoryItem: (itemId: string) => `/inventory/${itemId}`,
  inventoryItemEdit: (itemId: string) => `/inventory/${itemId}/edit`,
  maintenance: '/maintenance',
  maintenanceNew: '/maintenance/new',
  maintenanceRecord: (recordId: string) => `/maintenance/${recordId}`,
  maintenanceRecordEdit: (recordId: string) => `/maintenance/${recordId}/edit`,
  productions: '/productions',
  actionList: '/action-list',
  calendar: '/calendar',
  team: '/team',
  organizationSettings: '/organization-settings',
  account: '/account',
} as const

/** Static paths only; the inventory helpers above are functions. */
export type AppPath = Extract<(typeof paths)[keyof typeof paths], string>
