import { createContext } from 'react'
import type { User } from 'firebase/auth'
import type { UserProfile } from '@/types/user'

export interface AuthState {
  /** True until the first Firebase auth state resolution completes. */
  loading: boolean
  user: User | null
  profile: UserProfile | null
  /** Set when Firebase itself cannot be reached or configured. */
  configError: string | null
}

export const AuthContext = createContext<AuthState | undefined>(undefined)
