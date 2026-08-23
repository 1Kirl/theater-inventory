import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOrganization } from '@/features/organizations/useOrganization'
import { createOrganization } from '@/services/organization-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { paths } from '@/routes/paths'

export function CreateOrganizationPage() {
  const navigate = useNavigate()
  const { selectOrganization } = useOrganization()
  const nameFieldId = useId()

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return

    setError(null)

    if (name.trim().length === 0) {
      setError('Enter an organization name.')
      return
    }

    setSubmitting(true)
    try {
      const { organizationId } = await createOrganization({ name })
      selectOrganization(organizationId)
      navigate(paths.dashboard, { replace: true })
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>
            You become its Admin, and a join code is generated so you can invite your crew.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor={nameFieldId}>Organization name</Label>
              <Input
                id={nameFieldId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                disabled={submitting}
                autoFocus
                required
              />
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit" disabled={submitting} className="sm:flex-1">
                {submitting ? 'Creating…' : 'Create organization'}
              </Button>
              <Button asChild type="button" variant="outline" disabled={submitting}>
                <Link to={paths.organizations}>Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
