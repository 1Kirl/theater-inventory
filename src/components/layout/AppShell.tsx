import { Suspense, useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { Building2, Menu, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { SidebarNav } from '@/components/layout/SidebarNav'
import { RouteFallback } from '@/routes/RouteFallback'
import { SignOutButton } from '@/features/auth/SignOutButton'
import { useAuth } from '@/features/auth/useAuth'
import { useOrganization } from '@/features/organizations/useOrganization'
import { ROLE_LABELS } from '@/domain/organization-view'
import { effectiveDisplayName, teamNamesOf } from '@/domain/member-profile'
import { OrganizationProfileDialog } from '@/features/contacts/OrganizationProfileDialog'
import { ThemeToggle } from '@/features/theme/ThemeToggle'
import { paths } from '@/routes/paths'

const APP_NAME = 'Theater Inventory Tracker'

/**
 * Desktop uses a persistent left sidebar; narrow screens use a compact header
 * with a navigation Sheet, per the design system.
 */
export function AppShell() {
  const navigate = useNavigate()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const { profile } = useAuth()
  const { organization, membership, role, teams, clearOrganization } = useOrganization()

  // Who this person is *here*. The account name shows through when they have
  // not chosen anything different for this organization.
  const identity = effectiveDisplayName(membership, profile?.display_name)
  const teamNames = membership ? teamNamesOf(membership, teams) : []

  function switchOrganization() {
    clearOrganization()
    navigate(paths.organizations)
  }

  const organizationBlock = (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
        <span className="truncate text-sm font-semibold">{organization?.name ?? APP_NAME}</span>
      </div>
      {role ? (
        <div className="space-y-1">
          <Badge variant={role === 'admin' ? 'default' : 'secondary'}>{ROLE_LABELS[role]}</Badge>
          {/* An Admin can be on crews too, so this is shown beside the role
              rather than instead of it. */}
          {teamNames.length > 0 ? (
            <p className="text-muted-foreground truncate text-xs">{teamNames.join(' · ')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return (
    <div className="bg-background text-foreground min-h-svh">
      <aside className="border-border bg-card hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col md:border-r">
        <div className="border-border space-y-2 border-b px-4 py-3">
          {organizationBlock}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={switchOrganization}>
            Switch organization
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav isAdmin={role === 'admin'} />
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="border-border bg-background/95 sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="border-border border-b">
                <SheetTitle className="text-sm">{organization?.name ?? APP_NAME}</SheetTitle>
                {/* Radix expects a description on a dialog; the panel is a menu,
                    so it is announced rather than shown. */}
                <SheetDescription className="sr-only">
                  Navigate to a module, or switch organization.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 p-3">
                <SidebarNav isAdmin={role === 'admin'} onNavigate={() => setMobileNavOpen(false)} />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setMobileNavOpen(false)
                    switchOrganization()
                  }}
                >
                  Switch organization
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <span className="truncate text-sm font-semibold md:hidden">
            {organization?.name ?? APP_NAME}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link to={paths.account}>
                <span className="max-w-32 truncate">{identity}</span>
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Organization profile"
              title="Organization profile"
              onClick={() => { setEditingProfile(true) }}
            >
              <UserRound className="size-4" aria-hidden="true" />
            </Button>
            <SignOutButton variant="ghost" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6">
          {/* Route code is fetched on demand; the shell and its navigation stay
              mounted, so only the page area shows the fallback. */}
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {editingProfile ? (
        <OrganizationProfileDialog open onOpenChange={setEditingProfile} />
      ) : null}
    </div>
  )
}
