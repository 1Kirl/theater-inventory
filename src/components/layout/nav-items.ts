import {
  CalendarDays,
  ClipboardList,
  Contact,
  LayoutDashboard,
  Package,
  ScanLine,
  Settings,
  Theater,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { paths } from '@/routes/paths'
import type { PermissionModule } from '@/types/organization'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  adminOnly: boolean
  /** Hidden unless the user can view this module. Absent means always shown. */
  module?: PermissionModule
  /**
   * Reachable by somebody who has joined but has not been assigned yet.
   *
   * Only the directory. Everything else needs a permission they do not have, and
   * a link that leads to "you are not assigned" is worse than no link.
   */
  availableToUnassigned?: boolean
}

export const navItems: readonly NavItem[] = [
  { label: 'Dashboard', path: paths.dashboard, icon: LayoutDashboard, adminOnly: false },
  { label: 'Inventory', path: paths.inventory, icon: Package, adminOnly: false, module: 'inventory' },
  { label: 'Scan', path: paths.scanner, icon: ScanLine, adminOnly: false, module: 'inventory' },
  { label: 'Maintenance', path: paths.maintenance, icon: Wrench, adminOnly: false, module: 'maintenance' },
  { label: 'Productions', path: paths.productions, icon: Theater, adminOnly: false, module: 'productions' },
  { label: 'Action List', path: paths.actionList, icon: ClipboardList, adminOnly: false, module: 'productions' },
  { label: 'Calendar', path: paths.calendar, icon: CalendarDays, adminOnly: false, module: 'calendar' },
  {
    label: 'Contacts', path: paths.contacts, icon: Contact, adminOnly: false,
    availableToUnassigned: true,
  },
  { label: 'Organization Settings', path: paths.organizationSettings, icon: Settings, adminOnly: true },
]
