import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Camera, CameraOff, Check, Loader2, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { assignableTeamIds } from '@/domain/module-access'
import { membersOfTeam, useTeamMembers } from '@/features/inventory/useTeamMembers'
import { useOrganization } from '@/features/organizations/useOrganization'
import {
  createScanRunner, type DecodeRejection, type ScanContext, type ScanRunner,
} from '@/features/scanner/scan-runner'
import {
  SCAN_MODES, SCAN_MODE_LABELS, emptySession, modeMutates, sessionCounts,
  type ScanEntry, type ScanMode, type ScanSession,
} from '@/features/scanner/scan-session'
import {
  cameraErrorMessage, startCameraScanner, type CameraErrorKind, type CameraScanner,
} from '@/features/scanner/scanner-camera'
import { getInventoryItem } from '@/services/inventory-service'
import { getInventoryUnit } from '@/services/inventory-unit-service'
import { performLifecycleAction } from '@/services/unit-lifecycle-service'
import { paths } from '@/routes/paths'

const UNSET = '__unset__'

/** Module scope so the runner's dependencies are a stable, pure reference. */
const clientNow = () => Date.now()

interface ScannerContextRef {
  usingTeamId: string
  usingMemberUid: string
  organization: { organization_id: string } | null
}

/**
 * The scan context, read at scan time rather than at creation time.
 *
 * Lives outside the component because the ref is only ever dereferenced when a
 * code is decoded — never while rendering — and keeping the dereference out here
 * says so plainly instead of relying on a reader to notice the closure.
 */
function contextFromRef(ref: { current: ScannerContextRef }): ScanContext {
  const { usingTeamId, usingMemberUid, organization } = ref.current
  return {
    activeOrganizationId: organization?.organization_id ?? null,
    usingTeamId: usingTeamId === UNSET ? null : usingTeamId,
    usingMemberUid: usingMemberUid === UNSET ? null : usingMemberUid,
  }
}

/** A short buzz on success, a double on failure. Silent where unsupported. */
function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Some browsers expose it and then refuse. Feedback is a nicety.
  }
}

function OutcomeIcon({ entry }: { entry: ScanEntry }) {
  // Never colour alone: each outcome carries a shape and a word as well.
  if (entry.outcome === 'processing') {
    return <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (entry.outcome === 'success') {
    return <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
  }
  if (entry.outcome === 'warning') {
    return <AlertTriangle className="text-amber-600 dark:text-amber-400 size-4 shrink-0" aria-hidden="true" />
  }
  return <X className="text-destructive size-4 shrink-0" aria-hidden="true" />
}

const OUTCOME_WORD: Record<ScanEntry['outcome'], string> = {
  processing: 'Working', success: 'Done', warning: 'Skipped', failed: 'Failed',
}

/**
 * Scanning equipment, continuously.
 *
 * The camera stays open across scans, because the workflow this exists for is
 * somebody walking a storage room with a phone in one hand and a microphone in
 * the other. Reopening the camera between items would make it slower than a
 * clipboard.
 *
 * Nothing here decides what a scan means. Parsing, deduplication, and which
 * lifecycle move a mode implies all live in tested modules; this wires them to a
 * camera and to the screen.
 */
export function ScannerPage() {
  const { organization, membership, role, teams } = useOrganization()

  const [mode, setMode] = useState<ScanMode>('inspect')
  const [usingTeamId, setUsingTeamId] = useState<string>(UNSET)
  const [usingMemberUid, setUsingMemberUid] = useState<string>(UNSET)
  const [session, setSession] = useState<ScanSession>(() => emptySession('inspect'))
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState<CameraErrorKind | null>(null)
  const [rejection, setRejection] = useState<DecodeRejection | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraRef = useRef<CameraScanner | null>(null)

  const assignable = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
  const teamChoices = teams.filter((team) => assignable.includes(team.team_id))
  const members = useTeamMembers({
    organizationId: organization?.organization_id,
    enabled: mode === 'check_out',
  })
  const memberChoices = membersOfTeam(members, usingTeamId === UNSET ? null : usingTeamId)

  // The runner is built once and must still see current values, so it reads
  // them through a ref rather than through a closure captured at creation.
  const contextRef = useRef<ScannerContextRef>({ usingTeamId, usingMemberUid, organization })

  useEffect(() => {
    contextRef.current = { usingTeamId, usingMemberUid, organization }
  }, [usingTeamId, usingMemberUid, organization])

  // Built once, in an effect: it closes over a ref that must not be read while
  // rendering, and it lives exactly as long as this page is on screen.
  const [runner, setRunner] = useState<ScanRunner | null>(null)

  useEffect(() => {
    const created = createScanRunner({
      initialMode: 'inspect',
      getContext: () => contextFromRef(contextRef),
      deps: {
        readUnit: getInventoryUnit,
        readItem: getInventoryItem,
        perform: performLifecycleAction,
        now: clientNow,
      },
    })

    setRunner(created)
    return created.subscribe(setSession)
  }, [])

  const stopCamera = useCallback(() => {
    cameraRef.current?.stop()
    cameraRef.current = null
    setScanning(false)
  }, [])

  // Leaving the page for any reason releases the camera. Without this the
  // recording indicator stays lit after the person has navigated away.
  useEffect(() => stopCamera, [stopCamera])

  async function startCamera() {
    if (cameraRef.current || !videoRef.current || !runner) return
    setCameraError(null)
    setRejection(null)

    const camera = await startCameraScanner({
      video: videoRef.current,
      onDecode: (value) => {
        const refused = runner.handleDecoded(value)
        setRejection(refused)
        if (refused === null) buzz(30)
      },
      onError: (kind) => {
        setCameraError(kind)
        setScanning(false)
      },
    })

    cameraRef.current = camera
    setScanning(true)
  }

  function changeMode(next: ScanMode) {
    setMode(next)
    runner?.setMode(next)
    setRejection(null)
  }

  const counts = sessionCounts(session)
  const needsTeam = mode === 'check_out' && usingTeamId === UNSET
  const latest = session.entries[0] ?? null

  // Haptic confirmation for the person not looking at the screen. Keyed on the
  // unit and its outcome so it fires once per finished scan.
  const latestKey = latest ? `${latest.unitId}:${latest.outcome}` : null
  useEffect(() => {
    if (!latestKey || latestKey.endsWith(':processing')) return
    buzz(latestKey.endsWith(':success') ? 40 : [30, 60, 30])
  }, [latestKey])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Scan equipment</h1>
        <p className="text-muted-foreground text-sm">
          Point the camera at the label on a piece of equipment. The camera stays open, so you can
          work through a shelf without stopping.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What are you doing?</CardTitle>
          <CardDescription>
            Chosen before scanning, never guessed from what the equipment happens to be doing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {SCAN_MODES.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={mode === option ? 'default' : 'outline'}
                aria-pressed={mode === option}
                onClick={() => { changeMode(option) }}
              >
                {SCAN_MODE_LABELS[option]}
              </Button>
            ))}
          </div>

          <p className="text-muted-foreground text-sm">
            {mode === 'inspect'
              ? 'Reads each label and shows what the equipment is. Nothing is changed.'
              : mode === 'check_out'
                ? 'Marks available equipment as in use by the team you choose.'
                : 'Brings equipment that is out back onto the shelf.'}
          </p>

          {mode === 'check_out' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scan-team">Using team</Label>
                <Select
                  value={usingTeamId}
                  onValueChange={(value) => { setUsingTeamId(value); setUsingMemberUid(UNSET) }}
                >
                  <SelectTrigger id="scan-team">
                    <SelectValue placeholder="Which team is taking it?" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamChoices.map((team) => (
                      <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="scan-member">Using member (optional)</Label>
                <Select
                  value={usingMemberUid}
                  onValueChange={setUsingMemberUid}
                  disabled={usingTeamId === UNSET}
                >
                  <SelectTrigger id="scan-member"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Nobody in particular</SelectItem>
                    {memberChoices.map((member) => (
                      <SelectItem key={member.uid} value={member.uid}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {needsTeam ? (
            <Alert>
              <AlertDescription>
                Choose which team is taking equipment out before you start scanning.
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="bg-muted relative overflow-hidden rounded-md">
            <video
              ref={videoRef}
              className="aspect-[3/4] w-full object-cover sm:aspect-video"
              playsInline
              muted
              aria-label="Camera preview"
            />
            {scanning ? null : (
              <div className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm">
                The camera is off.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {scanning ? (
              <Button type="button" variant="outline" onClick={stopCamera}>
                <CameraOff className="size-4" aria-hidden="true" />
                Stop camera
              </Button>
            ) : (
              <Button type="button" onClick={() => { void startCamera() }} disabled={needsTeam || runner === null}>
                <Camera className="size-4" aria-hidden="true" />
                Start camera
              </Button>
            )}
            {session.entries.length > 0 ? (
              <Button type="button" variant="outline" onClick={() => { runner?.clear() }}>
                Clear session
              </Button>
            ) : null}
          </div>

          {cameraError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{cameraErrorMessage(cameraError)}</AlertDescription>
            </Alert>
          ) : null}

          {rejection ? (
            <Alert role="status">
              <AlertDescription>{rejection.message}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">This session</CardTitle>
              <CardDescription>
                {counts.total === 0
                  ? 'Nothing scanned yet.'
                  : `${counts.total} scanned · ${counts.success} done`
                    + `${counts.warning > 0 ? ` · ${counts.warning} skipped` : ''}`
                    + `${counts.failed > 0 ? ` · ${counts.failed} failed` : ''}`}
              </CardDescription>
            </div>
            {modeMutates(mode) ? (
              <Badge variant="secondary">{SCAN_MODE_LABELS[mode]}</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {session.entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Scanned equipment appears here. It is not saved anywhere — closing this page ends the
              session.
            </p>
          ) : (
            <ul className="space-y-2">
              {session.entries.map((entry) => (
                <li key={entry.unitId} className="flex items-start gap-3 rounded-md border p-3">
                  <OutcomeIcon entry={entry} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm font-medium">
                        {entry.assetCode ?? 'Equipment'}
                      </span>
                      <span className="text-muted-foreground text-xs">{OUTCOME_WORD[entry.outcome]}</span>
                    </p>
                    {entry.itemName ? (
                      <p className="text-muted-foreground truncate text-xs">{entry.itemName}</p>
                    ) : null}
                    <p className="text-sm">{entry.message}</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button asChild size="sm" variant="outline">
                        <Link to={paths.inventoryUnit(entry.unitId)}>View details</Link>
                      </Button>
                      {entry.outcome === 'processing' ? null : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => { runner?.forget(entry.unitId) }}
                        >
                          Scan again
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
