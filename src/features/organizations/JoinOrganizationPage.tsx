import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOrganization } from '@/features/organizations/useOrganization'
import { formatJoinCode } from '@/domain/join-code'
import { inspectJoinCode, joinOrganization, type JoinCodeInspection } from '@/services/join-code-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { paths } from '@/routes/paths'

/**
 * Two steps, mirroring the service split: inspect the code, then commit to
 * joining. The first is a single read; the second is the atomic batch.
 */
export function JoinOrganizationPage() {
  const navigate = useNavigate()
  const { selectOrganization } = useOrganization()
  const codeFieldId = useId()

  const [rawCode, setRawCode] = useState('')
  const [inspection, setInspection] = useState<JoinCodeInspection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleInspect(event: FormEvent) {
    event.preventDefault()
    if (submitting) return

    setError(null)
    setSubmitting(true)
    try {
      setInspection(await inspectJoinCode(rawCode))
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleJoin() {
    if (submitting || !inspection) return

    setError(null)
    setSubmitting(true)
    try {
      const { organizationId } = await joinOrganization(inspection.code)
      selectOrganization(organizationId)
      navigate(paths.dashboard, { replace: true })
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setSubmitting(false)
    }
  }

  function startOver() {
    setInspection(null)
    setError(null)
  }

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        {inspection === null ? (
          <>
            <CardHeader>
              <CardTitle>Join an organization</CardTitle>
              <CardDescription>
                Enter the code your director or stage manager shared with you.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInspect} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor={codeFieldId}>Organization code</Label>
                  <Input
                    id={codeFieldId}
                    value={rawCode}
                    onChange={(event) => setRawCode(event.target.value)}
                    placeholder="K7PF-N4XQ-T3WM-H9RC"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={submitting}
                    className="font-mono tracking-wide"
                    required
                  />
                  <p className="text-muted-foreground text-xs">
                    Dashes, spaces, and lower case are all fine.
                  </p>
                </div>

                {error ? (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" disabled={submitting} className="sm:flex-1">
                    {submitting ? 'Checking…' : 'Look up code'}
                  </Button>
                  <Button asChild type="button" variant="outline" disabled={submitting}>
                    <Link to={paths.organizations}>Cancel</Link>
                  </Button>
                </div>
              </form>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Join this organization?</CardTitle>
              <CardDescription>
                You will join with no teams and no permissions until an Admin assigns you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-border flex items-center gap-3 rounded-md border p-3">
                <Building2 className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{inspection.organizationName}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {formatJoinCode(inspection.code)}
                  </p>
                </div>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={handleJoin} disabled={submitting} className="sm:flex-1">
                  {submitting ? 'Joining…' : 'Join organization'}
                </Button>
                <Button type="button" variant="outline" onClick={startOver} disabled={submitting}>
                  Use a different code
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  )
}
