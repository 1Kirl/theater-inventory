import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { navItems } from '@/components/layout/nav-items'

interface SidebarNavProps {
  onNavigate?: () => void
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {navItems.map((item) => {
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
