import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/features/auth/useAuth'
import { useOrganization } from '@/features/organizations/useOrganization'
import { satisfiesAssignmentCondition } from '@/domain/effective-role'
import { listOrganizationDirectory } from '@/services/membership-service'
import { transferAdmin } from '@/services/organization-service'
import { getUserProfiles } from '@/services/user-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { paths } from '@/routes/paths'

interface Candidate {
  uid: string
  displayName: string
  keepsAccess: boolean
}

export function AdminTransferCard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { organization, membership, refresh } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [targetUid, setTargetUid] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!organizationId || !user) return
    try {
      const memberships = await listOrganizationDirectory(organizationId, { includeInactive: false })
      const eligible = memberships.filter((entry) => entry.uid !== user.uid)
      const profiles = await getUserProfiles(eligible.map((entry) => entry.uid))

      setCandidates(
        eligible
          .map((entry) => ({
            uid: entry.uid,
            displayName: profiles.get(entry.uid)?.display_name ?? 'Unknown member',
            keepsAccess: satisfiesAssignmentCondition(entry),
          }))
          .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      )
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    }
  }, [organizationId, user])

  useEffect(() => {
    void load()
  }, [load])

  const outgoingKeepsAccess = satisfiesAssignmentCondition(membership)
  const target = candidates.find((candidate) => candidate.uid === targetUid) ?? null

  async function transfer() {
    if (!organizationId || !target || submitting) return

    setError(null)
    setSubmitting(true)
    try {
      await transferAdmin({ organizationId, newAdminUid: target.uid })
      // The caller may no longer be Admin, so the whole context is re-read
      // rather than patched, and this page may stop being reachable.
      await refresh()
      navigate(paths.dashboard, { replace: true })
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transfer administration</CardTitle>
        <CardDescription>
          An organization always has exactly one Admin. Handing it over takes effect immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {candidates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No other active members yet. Someone else has to join before you can transfer
            administration.
          </p>
        ) : (
          <div className="max-w-sm space-y-2">
            <Label htmlFor="admin-transfer-target">New Admin</Label>
            <Select value={targetUid} onValueChange={setTargetUid} disabled={submitting}>
              <SelectTrigger id="admin-transfer-target">
                <SelectValue placeholder="Choose a member" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((candidate) => (
                  <SelectItem key={candidate.uid} value={candidate.uid}>
                    {candidate.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={!target || submitting}>
              {submitting ? 'Transferring…' : 'Transfer administration'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Make {target?.displayName} the Admin?</AlertDialogTitle>
              <AlertDialogDescription>
                They gain full access to this organization immediately. You keep your teams and
                permissions, so afterwards you will be{' '}
                {outgoingKeepsAccess
                  ? 'an ordinary Member.'
                  : 'Unassigned, because you hold no teams or module access — the new Admin can assign you.'}{' '}
                Only the new Admin can transfer administration back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={transfer}>Transfer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}
