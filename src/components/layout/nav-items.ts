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

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Admin-only items are marked here; permission gating arrives in Phase 3. */
  adminOnly: boolean
}

export const navItems: readonly NavItem[] = [
  { label: 'Dashboard', path: paths.dashboard, icon: LayoutDashboard, adminOnly: false },
  { label: 'Inventory', path: paths.inventory, icon: Package, adminOnly: false },
  { label: 'Maintenance', path: paths.maintenance, icon: Wrench, adminOnly: false },
  { label: 'Productions', path: paths.productions, icon: Theater, adminOnly: false },
  { label: 'Action List', path: paths.actionList, icon: ClipboardList, adminOnly: false },
  { label: 'Calendar', path: paths.calendar, icon: CalendarDays, adminOnly: false },
  { label: 'Team & Members', path: paths.team, icon: Users, adminOnly: true },
  { label: 'Organization Settings', path: paths.organizationSettings, icon: Settings, adminOnly: true },
]
