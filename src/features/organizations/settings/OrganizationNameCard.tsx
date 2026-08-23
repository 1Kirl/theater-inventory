import { useId, useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOrganization } from '@/features/organizations/useOrganization'
import { renameOrganization } from '@/services/organization-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'

export function OrganizationNameCard() {
  const { organization, refresh } = useOrganization()
  const fieldId = useId()

  const [name, setName] = useState(organization?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const unchanged = name.trim() === (organization?.name ?? '')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting || !organization) return

    setError(null)
    setSaved(false)
    setSubmitting(true)

    try {
      await renameOrganization({ organizationId: organization.organization_id, name })
      await refresh()
      setSaved(true)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization</CardTitle>
        <CardDescription>
          Renaming also updates the name shown to anyone checking the current join code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="max-w-sm space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={fieldId}>Name</Label>
            <Input
              id={fieldId}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setSaved(false)
              }}
              maxLength={100}
              disabled={submitting}
              required
            />
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {saved ? (
            <Alert>
              <AlertDescription>Organization renamed.</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={submitting || unchanged}>
            {submitting ? 'Saving…' : 'Save name'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
