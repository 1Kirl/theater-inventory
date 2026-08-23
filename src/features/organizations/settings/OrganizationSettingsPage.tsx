import { AdminTransferCard } from '@/features/organizations/settings/AdminTransferCard'
import { JoinCodeCard } from '@/features/organizations/settings/JoinCodeCard'
import { MembersCard } from '@/features/organizations/settings/MembersCard'
import { OrganizationNameCard } from '@/features/organizations/settings/OrganizationNameCard'
import { TeamsCard } from '@/features/organizations/settings/TeamsCard'

/** Admin only. The route is wrapped in AdminGuard; Rules enforce it for real. */
export function OrganizationSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Organization settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage the organization, its join code, teams, and who can do what.
        </p>
      </div>

      <OrganizationNameCard />
      <JoinCodeCard />
      <TeamsCard />
      <MembersCard />
      <AdminTransferCard />
    </div>
  )
}
