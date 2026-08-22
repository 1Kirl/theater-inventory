import { Outlet } from 'react-router-dom'

/** Centered, single-column layout for the pre-organization auth screens. */
export function AuthLayout() {
  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <h1 className="text-lg font-semibold tracking-tight">Theater Inventory Tracker</h1>
      <Outlet />
    </div>
  )
}
