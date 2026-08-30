import { describe, expect, it } from 'vitest'
import {
  STATUS_TONES,
  actionStatusTone,
  conditionTone,
  maintenanceStatusTone,
  productionStatusTone,
  unitStatusTone,
} from '@/domain/status-tone'
import { CONDITION_KEYS } from '@/domain/inventory'
import { MAINTENANCE_STATUSES } from '@/types/maintenance'
import { ACTION_STATUSES, PRODUCTION_STATUSES } from '@/types/production'
import { UNIT_STATUSES } from '@/types/inventory'

/**
 * The point of these is coverage and distinctness, not the specific shades.
 *
 * Asserting "available is positive" pins a decision that could reasonably
 * change. Asserting that every status resolves to a known tone, and that states
 * a person must tell apart do not collapse onto the same one, pins the property
 * that made the old per-feature vocabularies a problem.
 */

describe('every state has a tone', () => {
  it('1. unit statuses', () => {
    for (const status of UNIT_STATUSES) {
      expect(STATUS_TONES).toContain(unitStatusTone(status))
    }
  })

  it('2. maintenance statuses', () => {
    for (const status of MAINTENANCE_STATUSES) {
      expect(STATUS_TONES).toContain(maintenanceStatusTone(status))
    }
  })

  it('3. production statuses', () => {
    for (const status of PRODUCTION_STATUSES) {
      expect(STATUS_TONES).toContain(productionStatusTone(status))
    }
  })

  it('4. action statuses', () => {
    for (const status of ACTION_STATUSES) {
      expect(STATUS_TONES).toContain(actionStatusTone(status))
    }
  })

  it('5. conditions', () => {
    for (const condition of CONDITION_KEYS) {
      expect(STATUS_TONES).toContain(conditionTone(condition))
    }
  })

  it('6. the tone list has no duplicates', () => {
    expect(new Set(STATUS_TONES).size).toBe(STATUS_TONES.length)
  })
})

describe('states a person has to tell apart do not share a tone', () => {
  it('7. every unit status is visually distinct from every other', () => {
    const tones = UNIT_STATUSES.map(unitStatusTone)
    expect(new Set(tones).size).toBe(UNIT_STATUSES.length)
  })

  it('8. lost and retired are not the same, which is what the old palette got wrong', () => {
    expect(unitStatusTone('lost')).not.toBe(unitStatusTone('retired'))
  })

  it('9. available and in use are not the same', () => {
    expect(unitStatusTone('available')).not.toBe(unitStatusTone('in_use'))
  })

  it('10. every maintenance status is distinct', () => {
    const tones = MAINTENANCE_STATUSES.map(maintenanceStatusTone)
    expect(new Set(tones).size).toBe(MAINTENANCE_STATUSES.length)
  })

  it('11. ready for pickup is not the same as still in service', () => {
    // One needs somebody to go and collect it; the other does not.
    expect(maintenanceStatusTone('ready')).not.toBe(maintenanceStatusTone('in_service'))
  })

  it('12. a cancelled repair is not shown as a finished one', () => {
    expect(maintenanceStatusTone('cancelled')).not.toBe(maintenanceStatusTone('returned'))
  })

  it('13. every action status is distinct', () => {
    const tones = ACTION_STATUSES.map(actionStatusTone)
    expect(new Set(tones).size).toBe(ACTION_STATUSES.length)
  })

  it('14. cancelled work is not shown as done', () => {
    expect(actionStatusTone('cancelled')).not.toBe(actionStatusTone('done'))
  })

  it('15. every production status is distinct', () => {
    const tones = PRODUCTION_STATUSES.map(productionStatusTone)
    expect(new Set(tones).size).toBe(PRODUCTION_STATUSES.length)
  })

  it('16. every condition is distinct', () => {
    const tones = CONDITION_KEYS.map(conditionTone)
    expect(new Set(tones).size).toBe(CONDITION_KEYS.length)
  })

  it('17. needs repair and unusable are not the same', () => {
    // One is work to schedule; the other is equipment to write off.
    expect(conditionTone('needs_repair')).not.toBe(conditionTone('unusable'))
  })
})

describe('the two axes stay readable together', () => {
  it('18. the worst condition and the worst lifecycle state share a tone', () => {
    // Both are the alarming end of their own scale, and they are drawn as
    // different shapes, so sharing a colour is intended rather than a collision.
    expect(conditionTone('unusable')).toBe(unitStatusTone('lost'))
  })

  it('19. a healthy condition and an available unit share a tone', () => {
    expect(conditionTone('excellent')).toBe(unitStatusTone('available'))
  })

  it('20. good condition is not the same as excellent', () => {
    expect(conditionTone('good')).not.toBe(conditionTone('excellent'))
  })
})
