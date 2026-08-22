/**
 * User ID rules for the MVP.
 *
 * The product authenticates with a User ID, but Firebase Authentication needs an
 * email. A synthetic email is derived from the normalized User ID and used only
 * as an internal credential. It is never shown to the user.
 */

export const USER_ID_MIN_LENGTH = 3
export const USER_ID_MAX_LENGTH = 20

/** Reserved domain, per RFC 2606. Mail is never sent to it. */
export const SYNTHETIC_EMAIL_DOMAIN = 'theater-inventory.example.com'

const ALLOWED_CHARACTERS = /^[a-z0-9._-]+$/
const STARTS_ALPHANUMERIC = /^[a-z0-9]/

/**
 * Normalize a User ID for comparison and for deriving the synthetic email.
 * Normalization is what makes the identifier unique in practice: two sign-ups
 * differing only in case or surrounding whitespace resolve to the same account.
 */
export function normalizeUserId(rawUserId: string): string {
  return rawUserId.trim().toLowerCase()
}

export type UserIdValidationResult = { valid: true } | { valid: false; message: string }

/**
 * Validate an already-normalized User ID.
 */
export function validateUserId(normalizedUserId: string): UserIdValidationResult {
  if (normalizedUserId.length === 0) {
    return { valid: false, message: 'Enter a User ID.' }
  }

  if (normalizedUserId.length < USER_ID_MIN_LENGTH) {
    return {
      valid: false,
      message: `User ID must be at least ${USER_ID_MIN_LENGTH} characters.`,
    }
  }

  if (normalizedUserId.length > USER_ID_MAX_LENGTH) {
    return {
      valid: false,
      message: `User ID must be at most ${USER_ID_MAX_LENGTH} characters.`,
    }
  }

  if (!ALLOWED_CHARACTERS.test(normalizedUserId)) {
    return {
      valid: false,
      message: 'User ID may contain only letters, numbers, dots, underscores, and hyphens.',
    }
  }

  if (!STARTS_ALPHANUMERIC.test(normalizedUserId)) {
    return { valid: false, message: 'User ID must start with a letter or a number.' }
  }

  return { valid: true }
}

/**
 * Derive the internal Firebase Auth email for a normalized User ID.
 * Callers must validate the User ID first; an invalid one throws rather than
 * producing a malformed credential.
 */
export function toSyntheticEmail(normalizedUserId: string): string {
  const result = validateUserId(normalizedUserId)
  if (!result.valid) {
    throw new Error(`Cannot derive a synthetic email from an invalid User ID: ${result.message}`)
  }

  return `${normalizedUserId}@${SYNTHETIC_EMAIL_DOMAIN}`
}
