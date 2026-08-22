import { useContext } from 'react'
import { AuthContext, type AuthState } from '@/features/auth/auth-context'

export function useAuth(): AuthState {
  const context = useContext(AuthContext)

  if (context === undefined) {
    throw new Error('useAuth must be used inside an AuthProvider.')
  }

  return context
}
