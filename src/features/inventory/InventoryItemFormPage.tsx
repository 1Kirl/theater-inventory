import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { assignableTeamIds, canEditTeamScopedRecord } from '@/domain/module-access'
import {
  CONDITION_KEYS,
  CONDITION_LABELS,
  EMPTY_CONDITION_COUNTS,
  conditionCountsTotal,
  validateInventoryQuantities,
} from '@/domain/inventory'
import { createInventoryItem, getInventoryItem, updateInventoryItem } from '@/services/inventory-service'
import { toDateKey } from '@/domain/calendar'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { INVENTORY_CATEGORIES, type ConditionCounts, type InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

interface FormState {
  name: string
  category: string
  teamId: string
  quantityTotal: string
  quantityAvailable: string
  conditionCounts: Record<string, string>
  location: string
  lastInspected: string
  notes: string
}

const BLANK: FormState = {
  name: '',
  category: '',
  teamId: '',
  quantityTotal: '0',
  quantityAvailable: '0',
  conditionCounts: Object.fromEntries(CONDITION_KEYS.map((key) => [key, '0'])),
  location: '',
  lastInspected: '',
  notes: '',
}

function toNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function toCounts(state: FormState): ConditionCounts {
  const counts = { ...EMPTY_CONDITION_COUNTS }
  for (const key of CONDITION_KEYS) {
    counts[key] = toNumber(state.conditionCounts[key] ?? '0')
  }
  return counts
}

function fromItem(item: InventoryItem): FormState {
  return {
    name: item.name,
    category: item.category,
    teamId: item.team_id,
    quantityTotal: String(item.quantity_total),
    quantityAvailable: String(item.quantity_available),
    conditionCounts: Object.fromEntries(
      CONDITION_KEYS.map((key) => [key, String(item.condition_counts[key])]),
    ),
    location: item.location,
    lastInspected: item.last_inspected_at
      // Local parts: the input value is parsed back as local midnight.
      ? toDateKey(item.last_inspected_at.toDate())
      : '',
    notes: item.notes ?? '',
  }
}

export function InventoryItemFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate()
  const { itemId } = useParams<{ itemId: string }>()
  const { organization, membership, role, teams } = useOrganization()
  const fieldId = useId()

  const [state, setState] = useState<FormState>(BLANK)
  const [existing, setExisting] = useState<InventoryItem | null>(null)
  const [loading, setLoading] = useState(mode === 'edit')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const teamChoices = useMemo(() => {
    const allowed = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
    return teams.filter((team) => allowed.includes(team.team_id))
  }, [role, membership, teams])

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else.
  const load = useCallback((): Promise<void> => {
    if (mode !== 'edit' || !itemId) return Promise.resolve()
    const organizationId = organization?.organization_id

    return getInventoryItem(itemId).then(
      (item) => {
        setLoading(false)

        if (!item || item.organization_id !== organizationId) {
          setError('That inventory item was not found in this organization.')
          return
        }

        setExisting(item)
        setState(fromItem(item))
        setError(null)
      },
      (caught: unknown) => { setLoading(false); setError(toOrganizationErrorMessage(caught)) },
    )
  }, [mode, itemId, organization])

  useEffect(() => {
    void load()
  }, [load])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }))
  }

  function setCount(key: string, value: string) {
    setState((current) => ({
      ...current,
      conditionCounts: { ...current.conditionCounts, [key]: value },
    }))
  }

  const counts = toCounts(state)
  const total = toNumber(state.quantityTotal)
  const classified = conditionCountsTotal(counts)
  const unclassified = Number.isFinite(total) ? Math.max(total - classified, 0) : 0

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting || !organization) return

    setError(null)

    if (state.teamId.length === 0) {
      setError('Choose an owning team. Every item belongs to one.')
      return
    }

    const quantities = validateInventoryQuantities({
      quantityTotal: total,
      quantityAvailable: toNumber(state.quantityAvailable),
      conditionCounts: counts,
    })
    if (!quantities.valid) {
      setError(quantities.message)
      return
    }

    const input = {
      name: state.name,
      category: state.category,
      teamId: state.teamId,
      quantityTotal: total,
      quantityAvailable: toNumber(state.quantityAvailable),
      conditionCounts: counts,
      location: state.location,
      lastInspectedAt: state.lastInspected
        ? Timestamp.fromDate(new Date(`${state.lastInspected}T00:00:00`))
        : null,
      notes: state.notes,
    }

    setSubmitting(true)
    try {
      if (mode === 'edit' && existing) {
        await updateInventoryItem({ existing, input })
        navigate(paths.inventoryItem(existing.item_id), { replace: true })
      } else {
        const { itemId: created } = await createInventoryItem({
          organizationId: organization.organization_id,
          input,
        })
        navigate(paths.inventoryItem(created), { replace: true })
      }
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading item…</p>
  }

  if (mode === 'edit' && existing && !canEditTeamScopedRecord(role, membership, 'inventory', existing.team_id)) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            This item belongs to another team. You can view it, but only that team — or an Admin —
            can change it.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to={paths.inventoryItem(existing.item_id)}>Back to item</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={existing ? paths.inventoryItem(existing.item_id) : paths.inventory}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Cancel
        </Link>
      </Button>

      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === 'edit' ? 'Edit item' : 'Add inventory item'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader><CardTitle className="text-base">Item</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-name`}>Name</Label>
              <Input
                id={`${fieldId}-name`}
                value={state.name}
                onChange={(event) => set('name', event.target.value)}
                maxLength={120}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-category`}>Category</Label>
              <Select value={state.category} onValueChange={(value) => set('category', value)} disabled={submitting}>
                <SelectTrigger id={`${fieldId}-category`}><SelectValue placeholder="Choose a category" /></SelectTrigger>
                <SelectContent>
                  {INVENTORY_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-team`}>Owning team</Label>
              <Select value={state.teamId} onValueChange={(value) => set('teamId', value)} disabled={submitting}>
                <SelectTrigger id={`${fieldId}-team`}><SelectValue placeholder="Choose a team" /></SelectTrigger>
                <SelectContent>
                  {teamChoices.map((team) => (
                    <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {teamChoices.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  {role === 'admin'
                    ? 'Create a team in Organization Settings first.'
                    : 'You are not on a team that can own inventory. Ask your Admin.'}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {role === 'admin'
                    ? 'Admins may assign any team.'
                    : 'You may only assign teams you belong to.'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-location`}>Storage location</Label>
              <Input
                id={`${fieldId}-location`}
                value={state.location}
                onChange={(event) => set('location', event.target.value)}
                maxLength={120}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-inspected`}>Last inspected</Label>
              <Input
                id={`${fieldId}-inspected`}
                type="date"
                value={state.lastInspected}
                onChange={(event) => set('lastInspected', event.target.value)}
                disabled={submitting}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quantity</CardTitle>
            <CardDescription>
              Available quantity is yours to maintain. Sending units for repair will not change it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-total`}>Total quantity</Label>
              <Input
                id={`${fieldId}-total`}
                type="number"
                min={0}
                step={1}
                value={state.quantityTotal}
                onChange={(event) => set('quantityTotal', event.target.value)}
                disabled={submitting}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-available`}>Available quantity</Label>
              <Input
                id={`${fieldId}-available`}
                type="number"
                min={0}
                step={1}
                value={state.quantityAvailable}
                onChange={(event) => set('quantityAvailable', event.target.value)}
                disabled={submitting}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Condition</CardTitle>
            <CardDescription>
              Counts may add up to less than the total; the remainder shows as Unclassified. They
              may not add up to more.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {CONDITION_KEYS.map((key) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`${fieldId}-${key}`}>{CONDITION_LABELS[key]}</Label>
                  <Input
                    id={`${fieldId}-${key}`}
                    type="number"
                    min={0}
                    step={1}
                    value={state.conditionCounts[key] ?? '0'}
                    onChange={(event) => setCount(key, event.target.value)}
                    disabled={submitting}
                  />
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-sm tabular-nums">
              Classified {classified} · Unclassified {unclassified}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <textarea
              value={state.notes}
              onChange={(event) => set('notes', event.target.value)}
              maxLength={2000}
              rows={4}
              disabled={submitting}
              aria-label="Notes"
              className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </CardContent>
        </Card>

        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting || teamChoices.length === 0}>
            {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create item'}
          </Button>
          <Button asChild type="button" variant="outline" disabled={submitting}>
            <Link to={existing ? paths.inventoryItem(existing.item_id) : paths.inventory}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
