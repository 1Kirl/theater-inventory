import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase'
import { readFirebaseEnv } from '@/lib/env'
import { getUserProfile } from '@/services/user-service'
import { AuthContext, type AuthState } from '@/features/auth/auth-context'
import type { UserProfile } from '@/types/user'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Whether Firebase is configured is a synchronous fact about the build, so it
  // is settled during the first render rather than discovered in an effect. The
  // effect below then has nothing to report before it subscribes.
  const [configError] = useState<string | null>(() => {
    const result = readFirebaseEnv()
    if (result.ok) return null
    return `Firebase is not configured. Missing environment variables: ${result.missing.join(', ')}`
  })

  const [loading, setLoading] = useState(configError === null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    if (configError !== null) return

    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
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
  }, [configError])

  const value = useMemo<AuthState>(
    () => ({ loading, user, profile, configError }),
    [loading, user, profile, configError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
