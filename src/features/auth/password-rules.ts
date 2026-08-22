export const PASSWORD_MIN_LENGTH = 8

export type PasswordCheck = { valid: true } | { valid: false; message: string }

export function validateNewPassword(password: string, confirmPassword: string): PasswordCheck {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    }
  }

  if (password !== confirmPassword) {
    return { valid: false, message: 'Passwords do not match.' }
  }

  return { valid: true }
}
