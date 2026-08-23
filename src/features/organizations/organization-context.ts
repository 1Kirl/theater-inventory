import { createContext } from 'react'
import type { EffectiveRole } from '@/domain/effective-role'
import type {
  Organization,
  OrganizationMembership,
  TheaterTeam,
} from '@/types/organization'

export interface ActiveOrganizationState {
  /** True while the active organization is being resolved from Firestore. */
  loading: boolean
  organization: Organization | null
  membership: OrganizationMembership | null
  /** Computed from the two documents above; never read from Firestore. */
  role: EffectiveRole | null
  teams: TheaterTeam[]
  error: string | null
  selectOrganization: (organizationId: string) => void
  clearOrganization: () => void
  /** Re-read organization, membership, and teams — after a transfer, say. */
  refresh: () => Promise<void>
}

export const OrganizationContext = createContext<ActiveOrganizationState | undefined>(undefined)
