/**
 * Route paths for the organization-scoped application shell.
 *
 * Authentication and organization-selection routes are added in Phase 1 and
 * Phase 2; this file currently covers only the shell that surrounds the
 * operational modules.
 */
export const paths = {
  dashboard: '/',
  inventory: '/inventory',
  maintenance: '/maintenance',
  productions: '/productions',
  actionList: '/action-list',
  calendar: '/calendar',
  team: '/team',
  organizationSettings: '/organization-settings',
} as const

export type AppPath = (typeof paths)[keyof typeof paths]
