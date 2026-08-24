import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { hasModuleAccess } from '@/domain/module-access'
import { PRODUCTION_STATUS_LABELS } from '@/domain/production'
import { listProductions } from '@/services/production-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { PRODUCTION_STATUSES, type Production } from '@/types/production'
import { paths } from '@/routes/paths'

function dateRange(production: Production): string {
  const start = production.start_date?.toDate().toLocaleDateString()
  const end = production.end_date?.toDate().toLocaleDateString()
  if (start && end) return `${start} – ${end}`
  return start ?? end ?? 'No dates set'
}

export function ProductionListPage() {
  const { organization, membership, role } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const [productions, setProductions] = useState<Production[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('active-and-planning')

  const canCreate = hasModuleAccess(role, membership?.permissions ?? null, 'productions', 'edit')

  const load = useCallback(async () => {
    if (!organizationId) return
    setError(null)
    try {
      setProductions(await listProductions(organizationId))
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setProductions([])
    }
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  // Completed productions stay readable but are out of the default planning view.
  const visible = (productions ?? []).filter((production) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active-and-planning') return production.status !== 'completed'
    return production.status === statusFilter
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Productions</h1>
          <p className="text-muted-foreground text-sm">
            What each show needs, and what is missing for it.
          </p>
        </div>
        {canCreate ? (
          <Button asChild size="sm">
            <Link to={paths.productionNew}>
              <Plus className="size-4" aria-hidden="true" />
              New production
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="max-w-56">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filter by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active-and-planning">Planning and active</SelectItem>
            <SelectItem value="all">All productions</SelectItem>
            {PRODUCTION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>{PRODUCTION_STATUS_LABELS[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      {productions === null ? (
        <p className="text-muted-foreground text-sm">Loading productions…</p>
      ) : productions.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-medium">No productions yet.</p>
            <p className="text-muted-foreground text-sm">
              {canCreate
                ? 'Create one to start planning what it needs.'
                : 'Someone with productions edit access can create the first one.'}
            </p>
            {canCreate ? <Button asChild size="sm"><Link to={paths.productionNew}>New production</Link></Button> : null}
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card><CardContent className="pt-6"><p className="text-muted-foreground text-sm">No productions match this filter.</p></CardContent></Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((production) => (
            <li key={production.production_id}>
              <Link to={paths.production(production.production_id)} className="block h-full">
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="min-w-0 truncate text-base">{production.title}</CardTitle>
                      <Badge variant={production.status === 'active' ? 'default' : production.status === 'completed' ? 'secondary' : 'outline'}>
                        {PRODUCTION_STATUS_LABELS[production.status]}
                      </Badge>
                    </div>
                    <CardDescription>{dateRange(production)}</CardDescription>
                  </CardHeader>
                  {production.description ? (
                    <CardContent>
                      <p className="text-muted-foreground line-clamp-2 text-sm">{production.description}</p>
                    </CardContent>
                  ) : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
