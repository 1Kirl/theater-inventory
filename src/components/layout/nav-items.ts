import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Package,
  Settings,
  Theater,
  Users,
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
}

export const navItems: readonly NavItem[] = [
  { label: 'Dashboard', path: paths.dashboard, icon: LayoutDashboard, adminOnly: false },
  { label: 'Inventory', path: paths.inventory, icon: Package, adminOnly: false, module: 'inventory' },
  { label: 'Maintenance', path: paths.maintenance, icon: Wrench, adminOnly: false, module: 'maintenance' },
  { label: 'Productions', path: paths.productions, icon: Theater, adminOnly: false, module: 'productions' },
  { label: 'Action List', path: paths.actionList, icon: ClipboardList, adminOnly: false, module: 'productions' },
  { label: 'Calendar', path: paths.calendar, icon: CalendarDays, adminOnly: false },
  { label: 'Team & Members', path: paths.team, icon: Users, adminOnly: true },
  { label: 'Organization Settings', path: paths.organizationSettings, icon: Settings, adminOnly: true },
]
