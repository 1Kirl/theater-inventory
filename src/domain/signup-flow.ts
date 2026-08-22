/**
 * Sign-up is one action from the user's point of view, but two operations
 * underneath: creating the Firebase Auth account, then writing the profile
 * document. If the second fails, the first must not survive — an account with
 * no profile is an orphan the user cannot recover from and the Admin cannot
 * identify.
 *
 * This module owns that rule and takes its operations as parameters, so it is
 * testable without Firebase.
 */

export type SignUpStage = 'account' | 'profile'

/**
 * `not_needed` — the account was never created.
 * `succeeded`  — the profile failed and the account was removed.
 * `failed`     — the profile failed and the account could not be removed.
 */
export type RollbackOutcome = 'not_needed' | 'succeeded' | 'failed'

export class SignUpError extends Error {
  readonly stage: SignUpStage
  readonly rollback: RollbackOutcome

  constructor(stage: SignUpStage, rollback: RollbackOutcome, cause: unknown) {
    super(`Sign-up failed at the ${stage} stage.`, { cause })
    this.name = 'SignUpError'
    this.stage = stage
    this.rollback = rollback
  }
}

export interface SignUpSteps<TUser> {
  createAccount: () => Promise<TUser>
  createProfile: (user: TUser) => Promise<void>
  /** Undo the account creation. */
  deleteAccount: (user: TUser) => Promise<void>
  /** Last resort when the account cannot be deleted: end the session anyway. */
  signOut: () => Promise<void>
}

/**
 * Create an account and its profile, rolling the account back if the profile
 * cannot be written. Always throws `SignUpError` on failure, never leaving the
 * caller signed in to an account without a profile.
 */
export async function createAccountWithProfile<TUser>(
  steps: SignUpSteps<TUser>,
): Promise<TUser> {
  let user: TUser

  try {
    user = await steps.createAccount()
  } catch (cause) {
    throw new SignUpError('account', 'not_needed', cause)
  }

  try {
    await steps.createProfile(user)
  } catch (cause) {
    throw new SignUpError('profile', await rollBack(steps, user), cause)
  }

  return user
}

async function rollBack<TUser>(steps: SignUpSteps<TUser>, user: TUser): Promise<RollbackOutcome> {
  try {
    await steps.deleteAccount(user)
    return 'succeeded'
  } catch {
    // The account survives without a profile. Ending the session is the most
    // that can still be done, and its own failure must not mask the original
    // profile error.
    try {
      await steps.signOut()
    } catch {
      // Nothing further is possible here.
    }
    return 'failed'
  }
}
