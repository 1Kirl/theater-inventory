import { useContext } from 'react'
import {
  OrganizationContext,
  type ActiveOrganizationState,
} from '@/features/organizations/organization-context'

export function useOrganization(): ActiveOrganizationState {
  const context = useContext(OrganizationContext)

  if (context === undefined) {
    throw new Error('useOrganization must be used inside an OrganizationProvider.')
  }

  return context
}
