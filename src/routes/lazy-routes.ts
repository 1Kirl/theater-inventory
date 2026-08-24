import { lazy } from 'react'

/**
 * Every feature page, fetched on demand.
 *
 * They live in their own module so `router.tsx` exports only the router: a file
 * that exports both components and something else loses Fast Refresh, and the
 * router is the something else.
 *
 * What stays eager is what the first paint needs — the shell, the guards, the
 * providers, and the two authentication screens. Everything behind a guard is a
 * separate chunk, so the Firebase AI code travels with the two features that use
 * it rather than with the entry bundle.
 */
export const AccountPage = lazy(() => import('@/features/auth/AccountPage').then((m) => ({ default: m.AccountPage })))
export const ActionListPage = lazy(() => import('@/features/productions/ActionListPage').then((m) => ({ default: m.ActionListPage })))
export const CalendarPage = lazy(() => import('@/features/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))
export const CreateOrganizationPage = lazy(() => import('@/features/organizations/CreateOrganizationPage').then((m) => ({ default: m.CreateOrganizationPage })))
export const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })))
export const InventoryItemDetailPage = lazy(() => import('@/features/inventory/InventoryItemDetailPage').then((m) => ({ default: m.InventoryItemDetailPage })))
export const InventoryItemFormPage = lazy(() => import('@/features/inventory/InventoryItemFormPage').then((m) => ({ default: m.InventoryItemFormPage })))
export const InventoryListPage = lazy(() => import('@/features/inventory/InventoryListPage').then((m) => ({ default: m.InventoryListPage })))
export const JoinOrganizationPage = lazy(() => import('@/features/organizations/JoinOrganizationPage').then((m) => ({ default: m.JoinOrganizationPage })))
export const MaintenanceListPage = lazy(() => import('@/features/maintenance/MaintenanceListPage').then((m) => ({ default: m.MaintenanceListPage })))
export const MaintenanceRecordDetailPage = lazy(() => import('@/features/maintenance/MaintenanceRecordDetailPage').then((m) => ({ default: m.MaintenanceRecordDetailPage })))
export const MaintenanceRecordFormPage = lazy(() => import('@/features/maintenance/MaintenanceRecordFormPage').then((m) => ({ default: m.MaintenanceRecordFormPage })))
export const OrganizationSelectionPage = lazy(() => import('@/features/organizations/OrganizationSelectionPage').then((m) => ({ default: m.OrganizationSelectionPage })))
export const OrganizationSettingsPage = lazy(() => import('@/features/organizations/settings/OrganizationSettingsPage').then((m) => ({ default: m.OrganizationSettingsPage })))
export const ProductionDetailPage = lazy(() => import('@/features/productions/ProductionDetailPage').then((m) => ({ default: m.ProductionDetailPage })))
export const ProductionFormPage = lazy(() => import('@/features/productions/ProductionFormPage').then((m) => ({ default: m.ProductionFormPage })))
export const ProductionListPage = lazy(() => import('@/features/productions/ProductionListPage').then((m) => ({ default: m.ProductionListPage })))
