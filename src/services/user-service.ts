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

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const db = getFirebaseDb()
  const snapshot = await getDoc(doc(db, USERS_COLLECTION, uid))

  if (!snapshot.exists()) {
    return null
  }

  return snapshot.data() as UserProfile
}
