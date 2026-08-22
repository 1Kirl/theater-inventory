import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { validateNewPassword } from '@/features/auth/password-rules'
import { normalizeUserId, validateUserId } from '@/domain/user-id'
import { signUp } from '@/services/auth-service'
import { toSignUpErrorMessage } from '@/services/auth-errors'
import { paths } from '@/routes/paths'

export function SignUpPage() {
  const navigate = useNavigate()
  const userIdFieldId = useId()
  const displayNameFieldId = useId()
  const errorId = useId()

  const [userId, setUserId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    const normalized = normalizeUserId(userId)
    const userIdCheck = validateUserId(normalized)
    if (!userIdCheck.valid) {
      setError(userIdCheck.message)
      return
    }

    if (displayName.trim().length === 0) {
      setError('Enter a display name.')
      return
    }

    const passwordCheck = validateNewPassword(password, confirmPassword)
    if (!passwordCheck.valid) {
      setError(passwordCheck.message)
      return
    }

    setSubmitting(true)
    try {
      await signUp({ userId: normalized, displayName, password })
      navigate(paths.organizations, { replace: true })
    } catch (caught) {
      setError(toSignUpErrorMessage(caught))
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Your account is separate from any theater organization. You can join or create one after
          signing up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={userIdFieldId}>User ID</Label>
            <Input
              id={userIdFieldId}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={submitting}
              aria-describedby={`${userIdFieldId}-hint`}
              required
            />
            <p id={`${userIdFieldId}-hint`} className="text-muted-foreground text-xs">
              3–20 characters. Lowercase letters, numbers, dots, underscores, and hyphens. Must
              start with a letter or number. This cannot be changed later.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={displayNameFieldId}>Display name</Label>
            <Input
              id={displayNameFieldId}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              disabled={submitting}
              required
            />
          </div>

          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={submitting}
          />

          <PasswordInput
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            disabled={submitting}
            describedBy={error ? errorId : undefined}
          />

          {error ? (
            <Alert variant="destructive" id={errorId}>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link to={paths.logIn} className="text-foreground font-medium underline underline-offset-4">
            Log in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
