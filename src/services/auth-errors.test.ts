import { FirebaseError } from 'firebase/app'
import { describe, expect, it } from 'vitest'
import { SignUpError } from '@/domain/signup-flow'
import { toSignUpErrorMessage, toUserFacingMessage } from '@/services/auth-errors'

describe('toUserFacingMessage', () => {
  it('maps a duplicate account to a User ID message', () => {
    const message = toUserFacingMessage(new FirebaseError('auth/email-already-in-use', 'raw'))
    expect(message).toContain('User ID')
    expect(message).not.toContain('email')
  })

  it('gives the same message for a wrong password and an unknown account', () => {
    const wrongPassword = toUserFacingMessage(new FirebaseError('auth/wrong-password', 'raw'))
    const unknownUser = toUserFacingMessage(new FirebaseError('auth/user-not-found', 'raw'))
    const invalid = toUserFacingMessage(new FirebaseError('auth/invalid-credential', 'raw'))

    expect(wrongPassword).toBe(unknownUser)
    expect(wrongPassword).toBe(invalid)
  })

  it('falls back for unknown codes and non-Firebase errors', () => {
    expect(toUserFacingMessage(new FirebaseError('auth/something-new', 'raw'))).toBe(
      'Something went wrong. Try again.',
    )
    expect(toUserFacingMessage(new Error('boom'))).toBe('Something went wrong. Try again.')
    expect(toUserFacingMessage('boom')).toBe('Something went wrong. Try again.')
  })

  it('never leaks the raw Firebase message', () => {
    const raw = 'Firebase: Error (auth/wrong-password).'
    expect(toUserFacingMessage(new FirebaseError('auth/wrong-password', raw))).not.toContain(raw)
  })
})

describe('toSignUpErrorMessage', () => {
  it('surfaces the underlying reason when the account was never created', () => {
    const error = new SignUpError(
      'account',
      'not_needed',
      new FirebaseError('auth/email-already-in-use', 'raw'),
    )
    expect(toSignUpErrorMessage(error)).toContain('already taken')
  })

  it('tells the user nothing was saved when the rollback succeeded', () => {
    const error = new SignUpError('profile', 'succeeded', new Error('permission-denied'))
    const message = toSignUpErrorMessage(error)

    expect(message).toContain('nothing was saved')
    expect(message).toContain('try again')
  })

  it('directs the user to an administrator when the rollback failed', () => {
    const error = new SignUpError('profile', 'failed', new Error('permission-denied'))
    expect(toSignUpErrorMessage(error)).toContain('administrator')
  })

  it('distinguishes the two profile-stage outcomes', () => {
    const rolledBack = toSignUpErrorMessage(
      new SignUpError('profile', 'succeeded', new Error('x')),
    )
    const orphaned = toSignUpErrorMessage(new SignUpError('profile', 'failed', new Error('x')))

    expect(rolledBack).not.toBe(orphaned)
  })

  it('never mentions an email address in any branch', () => {
    const messages = [
      toSignUpErrorMessage(
        new SignUpError('account', 'not_needed', new FirebaseError('auth/email-already-in-use', 'r')),
      ),
      toSignUpErrorMessage(new SignUpError('profile', 'succeeded', new Error('x'))),
      toSignUpErrorMessage(new SignUpError('profile', 'failed', new Error('x'))),
    ]

    for (const message of messages) {
      expect(message).not.toContain('@')
      expect(message.toLowerCase()).not.toContain('email')
    }
  })

  it('falls back to the generic mapping for errors that are not SignUpError', () => {
    expect(toSignUpErrorMessage(new Error('boom'))).toBe('Something went wrong. Try again.')
  })
})
