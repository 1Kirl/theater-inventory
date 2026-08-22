import { describe, expect, it, vi } from 'vitest'
import { SignUpError, createAccountWithProfile, type SignUpSteps } from '@/domain/signup-flow'

interface FakeUser {
  uid: string
}

const user: FakeUser = { uid: 'uid-1' }

function makeSteps(overrides: Partial<SignUpSteps<FakeUser>> = {}): SignUpSteps<FakeUser> {
  return {
    createAccount: vi.fn(async () => user),
    createProfile: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('createAccountWithProfile', () => {
  it('returns the created user when both steps succeed', async () => {
    const steps = makeSteps()

    await expect(createAccountWithProfile(steps)).resolves.toBe(user)

    expect(steps.createProfile).toHaveBeenCalledWith(user)
    expect(steps.deleteAccount).not.toHaveBeenCalled()
    expect(steps.signOut).not.toHaveBeenCalled()
  })

  it('does not attempt a profile or a rollback when the account cannot be created', async () => {
    const cause = new Error('account failed')
    const steps = makeSteps({ createAccount: vi.fn(async () => Promise.reject(cause)) })

    const error = await createAccountWithProfile(steps).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SignUpError)
    expect((error as SignUpError).stage).toBe('account')
    expect((error as SignUpError).rollback).toBe('not_needed')
    expect((error as SignUpError).cause).toBe(cause)
    expect(steps.createProfile).not.toHaveBeenCalled()
    expect(steps.deleteAccount).not.toHaveBeenCalled()
  })

  it('deletes the account when the profile write fails', async () => {
    const cause = new Error('permission-denied')
    const steps = makeSteps({ createProfile: vi.fn(async () => Promise.reject(cause)) })

    const error = await createAccountWithProfile(steps).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SignUpError)
    expect((error as SignUpError).stage).toBe('profile')
    expect((error as SignUpError).rollback).toBe('succeeded')
    expect((error as SignUpError).cause).toBe(cause)
    expect(steps.deleteAccount).toHaveBeenCalledTimes(1)
    expect(steps.deleteAccount).toHaveBeenCalledWith(user)
    // Deleting the account already ends the session.
    expect(steps.signOut).not.toHaveBeenCalled()
  })

  it('signs out when the account cannot be deleted, leaving no active session', async () => {
    const cause = new Error('permission-denied')
    const steps = makeSteps({
      createProfile: vi.fn(async () => Promise.reject(cause)),
      deleteAccount: vi.fn(async () => Promise.reject(new Error('delete failed'))),
    })

    const error = await createAccountWithProfile(steps).catch((caught: unknown) => caught)

    expect((error as SignUpError).stage).toBe('profile')
    expect((error as SignUpError).rollback).toBe('failed')
    expect(steps.signOut).toHaveBeenCalledTimes(1)
  })

  it('preserves the original profile error even when sign-out also fails', async () => {
    const cause = new Error('permission-denied')
    const steps = makeSteps({
      createProfile: vi.fn(async () => Promise.reject(cause)),
      deleteAccount: vi.fn(async () => Promise.reject(new Error('delete failed'))),
      signOut: vi.fn(async () => Promise.reject(new Error('sign out failed'))),
    })

    const error = await createAccountWithProfile(steps).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(SignUpError)
    expect((error as SignUpError).rollback).toBe('failed')
    expect((error as SignUpError).cause).toBe(cause)
  })

  it('never resolves when the profile step fails', async () => {
    const steps = makeSteps({
      createProfile: vi.fn(async () => Promise.reject(new Error('nope'))),
    })

    await expect(createAccountWithProfile(steps)).rejects.toBeInstanceOf(SignUpError)
  })
})
