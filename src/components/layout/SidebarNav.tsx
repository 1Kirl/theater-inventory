import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { navItems } from '@/components/layout/nav-items'
import { hasModuleAccess } from '@/domain/module-access'
import { useOrganization } from '@/features/organizations/useOrganization'

interface SidebarNavProps {
  onNavigate?: (() => void) | undefined
  isAdmin?: boolean | undefined
}

export function SidebarNav({ onNavigate, isAdmin = false }: SidebarNavProps) {
  const { role, membership } = useOrganization()

  // Entries are hidden rather than shown disabled. Hiding is a convenience;
  // the guards and Security Rules are what actually stop access.
  const visibleItems = navItems.filter((item) => {
    // Somebody waiting for an assignment sees the one thing they can open.
    // Dashboard and the modules would all bounce them to the same screen they
    // just came from.
    if (role === 'unassigned') return item.availableToUnassigned === true

    if (item.adminOnly && !isAdmin) return false
    if (item.module) {
      return hasModuleAccess(role, membership?.permissions ?? null, item.module, 'view')
    }
    return true
  })

  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {visibleItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
