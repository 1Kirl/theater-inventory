import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase'
import { getUserProfile } from '@/services/user-service'
import { AuthContext, type AuthState } from '@/features/auth/auth-context'
import type { UserProfile } from '@/types/user'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  useEffect(() => {
    let auth
    try {
      auth = getFirebaseAuth()
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : 'Firebase is not configured.')
      setLoading(false)
      return
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)

      if (!nextUser) {
        setProfile(null)
        setLoading(false)
        return
      }

      // A missing profile is not fatal: the account exists and the user can
      // still sign out. Later phases surface it where it matters.
      getUserProfile(nextUser.uid)
        .then(setProfile)
        .catch(() => setProfile(null))
        .finally(() => setLoading(false))
    })

    return unsubscribe
  }, [])

  const value = useMemo<AuthState>(
    () => ({ loading, user, profile, configError }),
    [loading, user, profile, configError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
