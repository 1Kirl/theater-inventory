import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MAX_PROFILE_BIO, profileInputOf, teamNamesOf, validateProfile, type MemberProfileInput,
} from '@/domain/member-profile'
import { useOrganization } from '@/features/organizations/useOrganization'
import { updateMyOrganizationProfile } from '@/services/membership-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'

/**
 * How you appear in this organization, and nowhere else.
 *
 * Someone who belongs to two organizations edits two of these independently:
 * the same account can be "Jina Kim, sound crew" at one school and "Jina" at
 * another, and neither knows about the other.
 *
 * Teams are shown and not editable. Which crew somebody is on is a decision
 * their Admin makes; this is only how they are named and reached.
 */
export function OrganizationProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { organization, membership, teams, refresh } = useOrganization()

  const [input, setInput] = useState<MemberProfileInput>(() => profileInputOf(membership))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const teamNames = membership ? teamNamesOf(membership, teams) : []

  function set(patch: Partial<MemberProfileInput>) {
    setInput((current) => ({ ...current, ...patch }))
  }

  async function save() {
    if (saving || !organization) return

    const validation = validateProfile(input)
    if (!validation.valid) {
      setError(validation.message)
      return
    }

    setError(null)
    setSaving(true)
    try {
      await updateMyOrganizationProfile({
        organizationId: organization.organization_id,
        input: validation.input,
      })
      // Re-read the membership so the header and the directory show the new
      // name straight away, without a reload.
      await refresh()
      onOpenChange(false)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your profile in {organization?.name ?? 'this organization'}</DialogTitle>
          <DialogDescription>
  How you appear here. Separate from your account and from other organizations.
</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              id="profile-name"
              value={input.displayName}
              onChange={(event) => set({ displayName: event.target.value })}
              placeholder="Leave blank to use your account name"
              disabled={saving}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input
                id="profile-phone"
                inputMode="tel"
                value={input.phone}
                onChange={(event) => set({ phone: event.target.value })}
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-email">Contact email</Label>
              <Input
                id="profile-email"
                inputMode="email"
                autoComplete="email"
                value={input.contactEmail}
                onChange={(event) => set({ contactEmail: event.target.value })}
                disabled={saving}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-bio">About</Label>
            <textarea
              id="profile-bio"
              className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
              value={input.bio}
              maxLength={MAX_PROFILE_BIO}
              onChange={(event) => set({ bio: event.target.value })}
              placeholder="What you do here, in a sentence."
              disabled={saving}
            />
            <p className="text-muted-foreground text-xs">
              {input.bio.trim().length}/{MAX_PROFILE_BIO}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Your teams</p>
            {teamNames.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {teamNames.map((name) => (
                  <Badge key={name} variant="secondary">{name}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No team yet.</p>
            )}
            <p className="text-muted-foreground text-xs">
              Teams are assigned by your Admin and cannot be changed here.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { onOpenChange(false) }} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => { void save() }} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
