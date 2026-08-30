import type { ConditionKey, UnitStatus } from '@/types/inventory'
import type { MaintenanceStatus } from '@/types/maintenance'
import type { ActionStatus, ProductionStatus } from '@/types/production'

/**
 * One colour vocabulary for every state the application shows.
 *
 * Before this, each feature invented its own: `UnitStatusTone` had four names,
 * maintenance had three different ones, and actions and conditions had none and
 * rendered whatever badge variant was nearest. All of them collapsed into the
 * same two or three greys, so a lost microphone and a retired one looked alike,
 * and "In use" looked like "Unusable".
 *
 * A tone is a meaning, not a colour. The colour it resolves to is a CSS token
 * defined once per theme, which is what keeps light and dark in step: adding a
 * tone here without a token there is a missing variable, not a wrong shade.
 *
 * Colour is never the only carrier. Every badge shows its label, and condition
 * is drawn differently from lifecycle so that two green pills cannot be mistaken
 * for the same kind of statement.
 */
export const STATUS_TONES = [
  'positive',
  'ready',
  'info',
  'planned',
  'warning',
  'caution',
  'danger',
  'neutral',
] as const

export type StatusTone = (typeof STATUS_TONES)[number]

/**
 * Where a piece of equipment is in its life.
 *
 * `retired` is neutral rather than negative: a disposed lamp is a closed record,
 * not a problem to solve. `lost` is the one that should catch the eye.
 */
export function unitStatusTone(status: UnitStatus): StatusTone {
  switch (status) {
    case 'available': return 'positive'
    case 'in_use': return 'info'
    case 'in_maintenance': return 'warning'
    case 'lost': return 'danger'
    case 'retired': return 'neutral'
  }
}

/**
 * How far along a repair is.
 *
 * The three middle states are deliberately distinct. "Sent" and "In service"
 * both mean the equipment is away, but only one of them means somebody is
 * working on it, and "Ready for pickup" is the one that needs a person to act.
 */
export function maintenanceStatusTone(status: MaintenanceStatus): StatusTone {
  switch (status) {
    case 'planned': return 'planned'
    case 'sent': return 'info'
    case 'in_service': return 'warning'
    case 'ready': return 'ready'
    case 'returned': return 'positive'
    case 'cancelled': return 'neutral'
  }
}

export function productionStatusTone(status: ProductionStatus): StatusTone {
  switch (status) {
    case 'planning': return 'planned'
    case 'active': return 'info'
    case 'completed': return 'positive'
  }
}

export function actionStatusTone(status: ActionStatus): StatusTone {
  switch (status) {
    case 'todo': return 'info'
    case 'in_progress': return 'warning'
    case 'done': return 'positive'
    case 'cancelled': return 'neutral'
  }
}

/**
 * What physical shape something is in, which is a different question from where
 * it is in its life.
 *
 * The scale runs the same direction as the lifecycle tones and reuses the same
 * colours on purpose — fair is amber wherever it appears — but a condition is
 * rendered as a dotted chip rather than a filled pill, so the two axes stay
 * distinguishable at a glance. A unit can be available and unusable at once, and
 * the interface has to be able to say that without looking self-contradictory.
 */
export function conditionTone(condition: ConditionKey): StatusTone {
  switch (condition) {
    case 'excellent': return 'positive'
    case 'good': return 'ready'
    case 'fair': return 'warning'
    case 'needs_repair': return 'caution'
    case 'unusable': return 'danger'
  }
}
