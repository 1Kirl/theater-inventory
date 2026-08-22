import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { logIn } from '@/services/auth-service'
import { toUserFacingMessage } from '@/services/auth-errors'
import { paths } from '@/routes/paths'

export function LogInPage() {
  const navigate = useNavigate()
  const userIdFieldId = useId()
  const errorId = useId()

  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await logIn({ userId, password })
      navigate(paths.organizations, { replace: true })
    } catch (caught) {
      // logIn throws a plain Error for malformed input so that it is
      // indistinguishable from a wrong password.
      setError(caught instanceof Error && !('code' in caught)
        ? caught.message
        : toUserFacingMessage(caught))
      setSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Sign in with your User ID.</CardDescription>
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
              required
            />
          </div>

          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={submitting}
            describedBy={error ? errorId : undefined}
          />

          {error ? (
            <Alert variant="destructive" id={errorId}>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Log in'}
          </Button>
        </form>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Need an account?{' '}
          <Link to={paths.signUp} className="text-foreground font-medium underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
