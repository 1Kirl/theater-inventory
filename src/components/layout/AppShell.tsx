import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { SidebarNav } from '@/components/layout/SidebarNav'

const APP_NAME = 'Theater Inventory Tracker'

/**
 * Desktop uses a persistent left sidebar; narrow screens use a compact header
 * with a navigation Sheet, per the design system.
 */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="bg-background text-foreground min-h-svh">
      <aside className="border-border bg-card hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col md:border-r">
        <div className="border-border flex h-14 items-center border-b px-4">
          <span className="truncate text-sm font-semibold">{APP_NAME}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav />
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
                <SheetTitle className="text-sm">{APP_NAME}</SheetTitle>
              </SheetHeader>
              <div className="p-3">
                <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <span className="truncate text-sm font-semibold md:hidden">{APP_NAME}</span>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
