import { DeepLinkNotice } from '@/features/inventory/DeepLinkNotice'
import type { EquipmentScanOutcome } from '@/features/inventory/equipment-scan-view'

/** The unit label's wording for the shared deep-link notice. */
const EQUIPMENT_WORDING = {
  noun: 'equipment',
  belongsTo: 'This equipment belongs to',
  switchAction: 'Switch organization and view equipment',
}

export function EquipmentScanNotice({ outcome }: { outcome: EquipmentScanOutcome }) {
  // `ready` carries `unit`; the shared notice renders nothing for it either way.
  const shared = outcome.kind === 'ready' ? { kind: 'ready' as const, record: outcome.unit } : outcome
  return <DeepLinkNotice outcome={shared} wording={EQUIPMENT_WORDING} />
}
