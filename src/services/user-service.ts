import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/lib/firebase'
import type { UserProfile } from '@/types/user'

const USERS_COLLECTION = 'users'

/**
 * Firestore access for users/{uid}. Components never call the SDK directly.
 */
export async function createUserProfile(params: {
  uid: string
  userId: string
  displayName: string
}): Promise<void> {
  const db = getFirebaseDb()

  await setDoc(doc(db, USERS_COLLECTION, params.uid), {
    uid: params.uid,
    user_id: params.userId,
    display_name: params.displayName,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })
}

/**
 * Profiles for a set of uids, fetched by document ID.
 *
 * The users collection cannot be queried — `list` is denied so accounts cannot
 * be enumerated — so a member directory reads each profile individually. A
 * missing profile is omitted rather than failing the whole directory.
 */
export async function getUserProfiles(uids: readonly string[]): Promise<Map<string, UserProfile>> {
  const entries = await Promise.all(
    uids.map(async (uid) => [uid, await getUserProfile(uid).catch(() => null)] as const),
  )

  const profiles = new Map<string, UserProfile>()
  for (const [uid, profile] of entries) {
    if (profile) profiles.set(uid, profile)
  }
  return profiles
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getFirebaseDb()
  const snapshot = await getDoc(doc(db, USERS_COLLECTION, uid))

  if (!snapshot.exists()) {
    return null
  }

  return snapshot.data() as UserProfile
}
