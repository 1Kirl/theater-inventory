import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import type { ScanMode } from '@/features/scanner/scan-session'
import type { InventoryUnit, UnitStatus } from '@/types/inventory'

/**
 * What a scan should do, decided before anything is written.
 *
 * The scanner performs exactly the one transition its mode names, and nothing
 * else. That is narrower than the lifecycle allows on purpose: `lost` may become
 * `available` from the unit page, where a person has read the history and chosen
 * to mark it found, but a check-in sweep must never do that silently. Somebody
 * walking a storage room is looking at equipment, not at each unit's state, and
 * a tool that quietly resurrected lost equipment because it happened to be in
 * the returns bin would be worse than one that stops and says something.
 *
 * So every state that is not the expected one produces a warning and no write.
 */
export type ScanPlan =
  /** Read only. Nothing is written. */
  | { kind: 'inspect' }
  /** Perform this lifecycle move through the existing service. */
  | { kind: 'mutate'; to: UnitStatus }
  /** Say why nothing happened. `warning` is an expected state, `failed` is not. */
  | { kind: 'refuse'; outcome: 'warning' | 'failed'; message: string }

function label(unit: Pick<InventoryUnit, 'asset_code'>): string {
  return unit.asset_code.trim().length > 0 ? unit.asset_code : 'This equipment'
}

/** Why a unit in this state cannot be taken out, in words worth reading twice. */
function checkOutRefusal(unit: InventoryUnit): string | null {
  switch (unit.status) {
    case 'available':
      return null
    case 'in_use':
      return `${label(unit)} is already checked out.`
    case 'in_maintenance':
      return `${label(unit)} is currently in maintenance.`
    case 'lost':
      return `${label(unit)} is marked lost. Mark it found on its details page first.`
    case 'retired':
      return `${label(unit)} is retired and cannot be taken out.`
  }
}

function checkInRefusal(unit: InventoryUnit): string | null {
  switch (unit.status) {
    case 'in_use':
      return null
    case 'available':
      return `${label(unit)} is already checked in.`
    case 'in_maintenance':
      return `${label(unit)} is currently in maintenance.`
    case 'lost':
      // The lifecycle would allow lost -> available, and that is exactly why
      // this is spelled out: marking equipment found is a decision somebody
      // makes on the unit page, not a side effect of pointing a camera at it.
      return `${label(unit)} is marked lost. Mark it found on its details page first.`
    case 'retired':
      return `${label(unit)} is retired.`
  }
}

export function planScan(params: {
  mode: ScanMode
  unit: InventoryUnit
  activeOrganizationId: string | null
  /** Required before a check-out session can start. */
  usingTeamId: string | null
}): ScanPlan {
  // Reading it succeeded, so this person may see it — but a scanner session is
  // deliberately scoped to the organization it was opened in, and writing to
  // another one from inside a sweep is not something anybody asked for.
  if (params.unit.organization_id !== params.activeOrganizationId) {
    return {
      kind: 'refuse',
      outcome: 'warning',
      message: 'This equipment belongs to another organization.',
    }
  }

  if (params.mode === 'inspect') return { kind: 'inspect' }

  if (params.mode === 'check_out') {
    const refusal = checkOutRefusal(params.unit)
    if (refusal) return { kind: 'refuse', outcome: 'warning', message: refusal }

    if ((params.usingTeamId ?? '').trim().length === 0) {
      return {
        kind: 'refuse',
        outcome: 'failed',
        message: 'Choose which team is taking equipment out before scanning.',
      }
    }

    return { kind: 'mutate', to: 'in_use' }
  }

  const refusal = checkInRefusal(params.unit)
  if (refusal) return { kind: 'refuse', outcome: 'warning', message: refusal }

  return { kind: 'mutate', to: 'available' }
}

/** What a successful move should say once it has happened. */
export function successMessage(mode: ScanMode, unit: InventoryUnit): string {
  if (mode === 'check_out') return `${label(unit)} checked out.`
  if (mode === 'check_in') return `${label(unit)} checked in.`
  return `${label(unit)} · ${UNIT_STATUS_LABELS[unit.status]}`
}
