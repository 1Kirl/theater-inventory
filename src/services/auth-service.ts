import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase'
import { normalizeUserId, toSyntheticEmail, validateUserId } from '@/domain/user-id'
import { createAccountWithProfile } from '@/domain/signup-flow'
import { createUserProfile } from '@/services/user-service'

/**
 * Authentication operations. Firebase Auth is reached only from here, and the
 * synthetic email never leaves this module boundary in a user-visible form.
 */

export interface SignUpInput {
  userId: string
  displayName: string
  password: string
}

export interface LogInInput {
  userId: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/**
 * Create the account and its profile as one unit.
 *
 * Uniqueness of the User ID is enforced by Firebase Auth itself: the synthetic
 * email is derived deterministically, so a duplicate User ID fails with
 * auth/email-already-in-use. No separate uniqueness collection is needed.
 *
 * If the profile write fails, the account is rolled back. See
 * `createAccountWithProfile` for why, and `SignUpError` for what the caller
 * receives.
 */
export async function signUp(input: SignUpInput): Promise<User> {
  const userId = normalizeUserId(input.userId)
  const validation = validateUserId(userId)
  if (!validation.valid) {
    throw new Error(validation.message)
  }

  const auth = getFirebaseAuth()
  const displayName = input.displayName.trim()

  return createAccountWithProfile<User>({
    createAccount: async () => {
      const credential = await createUserWithEmailAndPassword(
        auth,
        toSyntheticEmail(userId),
        input.password,
      )
      return credential.user
    },
    createProfile: (user) => createUserProfile({ uid: user.uid, userId, displayName }),
    deleteAccount: (user) => deleteUser(user),
    signOut: () => signOut(auth),
  })
}

export async function logIn(input: LogInInput): Promise<User> {
  const userId = normalizeUserId(input.userId)
  const validation = validateUserId(userId)
  if (!validation.valid) {
    // Do not echo the format rule here; a wrong-format ID and a wrong password
    // should be indistinguishable to someone probing for valid User IDs.
    throw new Error('Incorrect User ID or password.')
  }

  const credential = await signInWithEmailAndPassword(
    getFirebaseAuth(),
    toSyntheticEmail(userId),
    input.password,
  )

  return credential.user
}

export async function logOut(): Promise<void> {
  await signOut(getFirebaseAuth())
}

/**
 * Firebase requires a recent login before a password change, so the current
 * password is used to reauthenticate first.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const auth = getFirebaseAuth()
  const user = auth.currentUser

  if (!user?.email) {
    throw new Error('You are not signed in.')
  }

  const credential = EmailAuthProvider.credential(user.email, input.currentPassword)
  await reauthenticateWithCredential(user, credential)
  await updatePassword(user, input.newPassword)
}
