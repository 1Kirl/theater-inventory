import { FirebaseError } from 'firebase/app'
import { SignUpError } from '@/domain/signup-flow'

/**
 * Translate Firebase error codes into messages a theater crew member can act on.
 *
 * Raw Firebase errors are never shown. Messages also avoid revealing that the
 * credential is an email underneath, since the product identity is a User ID.
 */
const AUTH_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'That User ID is already taken. Choose a different one.',
  'auth/invalid-credential': 'Incorrect User ID or password.',
  'auth/user-not-found': 'Incorrect User ID or password.',
  'auth/wrong-password': 'Incorrect User ID or password.',
  'auth/invalid-email': 'That User ID cannot be used. Choose a different one.',
  'auth/user-disabled': 'This account has been disabled. Contact your organization Admin.',
  'auth/weak-password': 'Password is too weak. Use a longer password.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/requires-recent-login': 'For security, sign in again before changing your password.',
  'auth/operation-not-allowed': 'Sign-in is not enabled for this project. Contact the administrator.',
}

const FIRESTORE_MESSAGES: Record<string, string> = {
  'permission-denied': 'You do not have permission to complete this action.',
  unavailable: 'Cannot reach the database right now. Try again in a moment.',
}

const FALLBACK_MESSAGE = 'Something went wrong. Try again.'

export function toUserFacingMessage(error: unknown): string {
  if (error instanceof FirebaseError) {
    return AUTH_MESSAGES[error.code] ?? FIRESTORE_MESSAGES[error.code] ?? FALLBACK_MESSAGE
  }

  return FALLBACK_MESSAGE
}

/**
 * Sign-up needs its own mapping because a failure after the account was created
 * means something different to the user than a failure before it.
 *
 * Neither branch mentions the credential or the synthetic email.
 */
export function toSignUpErrorMessage(error: unknown): string {
  if (!(error instanceof SignUpError)) {
    return toUserFacingMessage(error)
  }

  if (error.stage === 'account') {
    return toUserFacingMessage(error.cause)
  }

  if (error.rollback === 'succeeded') {
    return 'Could not finish creating your account, so nothing was saved. Please try again.'
  }

  // The account exists without a profile and could not be removed. The user
  // cannot fix this alone.
  return 'Could not finish creating your account. Ask your administrator to check this User ID before trying again.'
}
