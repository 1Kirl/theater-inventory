import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { navItems } from '@/components/layout/nav-items'
import { activeNavPath } from '@/components/layout/active-nav'
import { hasModuleAccess } from '@/domain/module-access'
import { useOrganization } from '@/features/organizations/useOrganization'

interface SidebarNavProps {
  onNavigate?: (() => void) | undefined
  isAdmin?: boolean | undefined
}

export function SidebarNav({ onNavigate, isAdmin = false }: SidebarNavProps) {
  const { role, membership } = useOrganization()
  const location = useLocation()

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

  // Decided once for the whole bar rather than per link, because one
  // destination lives underneath another — Scan is at /inventory/scan — and
  // per-link prefix matching lit both. Desktop and the mobile sheet both render
  // this component, so there is one answer and not two matchers.
  const activePath = activeNavPath(location.pathname, visibleItems.map((item) => item.path))

  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {visibleItems.map((item) => {
        const Icon = item.icon
        const isActive = item.path === activePath

        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            // Left as the resolver's answer rather than NavLink's own: its
            // default would mark every prefix match as the current page, which
            // is the same defect repeated in the accessibility tree.
            aria-current={isActive ? 'page' : undefined}
            // The callback form is deliberate even though its argument is
            // unused — given a plain string, NavLink appends its own `active`
            // class on a prefix match, which is the state being corrected here.
            className={() =>
              cn(
                'group relative flex items-center gap-3 rounded-md py-2 pr-3 pl-3 text-sm',
                'font-medium transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                isActive
                  // A tinted surface and a marker on the leading edge. Two
                  // signals rather than one, because a pale green wash on its
                  // own is easy to miss on a bright screen and impossible to see
                  // at all for somebody who cannot separate it from white.
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
              )
            }
          >
            {isActive ? (
              <span
                className="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full"
                aria-hidden="true"
              />
            ) : null}
            <Icon
              className={cn('size-4 shrink-0 transition-colors', isActive ? 'text-primary' : '')}
              aria-hidden="true"
            />
            <span className="truncate">{item.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
