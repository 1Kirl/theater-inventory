import type { Timestamp } from 'firebase/firestore'

/**
 * Personal user profile, independent from any organization.
 * Path: users/{uid}
 *
 * The synthetic Firebase Auth email is an implementation detail and is
 * deliberately absent from this document.
 */
export interface UserProfile {
  uid: string
  /** Public login identifier, normalized. Immutable in the MVP. */
  user_id: string
  display_name: string
  created_at: Timestamp
  updated_at: Timestamp
}
