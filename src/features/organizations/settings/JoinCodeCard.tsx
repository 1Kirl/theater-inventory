import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { formatJoinCode } from '@/domain/join-code'
import { getCurrentJoinCode, regenerateJoinCode } from '@/services/join-code-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'

export function JoinCodeCard() {
  const { organization } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const [code, setCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    if (!organizationId) return Promise.resolve()

    return getCurrentJoinCode(organizationId).then(
      (loaded) => { setCode(loaded); setError(null); setLoading(false) },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setLoading(false) },
    )
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(formatJoinCode(code))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy. Select the code and copy it manually.')
    }
  }

  async function regenerate() {
    if (!organizationId) return
    setRegenerating(true)
    setError(null)
    try {
      const { joinCode } = await regenerateJoinCode(organizationId)
      setCode(joinCode)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Join code</CardTitle>
        <CardDescription>
          Share this with your crew. Only you can see it — members never learn the current code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading code…</p>
        ) : code ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="border-border bg-muted rounded-md border px-3 py-2 font-mono text-sm tracking-wider break-all">
              {formatJoinCode(code)}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No join code found.</p>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={regenerating || !code}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {regenerating ? 'Regenerating…' : 'Regenerate code'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate the join code?</AlertDialogTitle>
              <AlertDialogDescription>
                The current code stops working immediately. Anyone still holding it will not be able
                to join, and you will need to share the new one. Members who have already joined are
                unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={regenerate}>Regenerate</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
