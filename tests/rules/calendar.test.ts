import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
  writeBatch, Timestamp, type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildCalendarEventDocument } from '@/domain/calendar-payloads'
import { buildProductionDocument } from '@/domain/production-payloads'
import {
  ADMIN, CODE_A, CODE_B, ORG_A, ORG_B, OUTSIDER, TEAM_COSTUME, TEAM_LIGHTING, TEAM_OTHER_ORG,
  assertFails, assertSucceeds, createTestEnvironment, seedMembership, seedOrganization, seedTeam,
} from './helpers'

let environment: RulesTestEnvironment

const VIEWER = 'uid-cal-viewer'
const EDITOR = 'uid-cal-editor'
const NO_ACCESS = 'uid-cal-none'
const DEACTIVATED = 'uid-cal-deactivated'

const EVENT_A = 'eventAAAAAAAAAAAAAA1'
const EVENT_OTHER_ORG = 'eventOTHERORGBBBBBB1'
const PROD_A = 'prodAAAAAAAAAAAAAAAA'
const PROD_B = 'prodBBBBBBBBBBBBBBBB'

const VIEW_CAL = { inventory: 'none', maintenance: 'none', productions: 'none', calendar: 'view' } as const
const EDIT_CAL = { inventory: 'none', maintenance: 'none', productions: 'none', calendar: 'edit' } as const
const NO_CAL = { inventory: 'edit', maintenance: 'edit', productions: 'edit', calendar: 'none' } as const

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

/** The same payload the calendar service builds. */
function eventDoc(o: {
  eventId?: string; organizationId?: string; uid?: string
  visibility?: 'all_teams' | 'teams'; teamIds?: string[]
  startTime?: string; endTime?: string
  productionId?: string; maintenanceId?: string
} = {}) {
  return buildCalendarEventDocument({
    eventId: o.eventId ?? EVENT_A,
    organizationId: o.organizationId ?? ORG_A,
    uid: o.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      title: 'Dress Rehearsal',
      eventType: 'Rehearsal',
      eventDate: Timestamp.fromDate(new Date(2026, 7, 24)),
      visibility: o.visibility ?? 'all_teams',
      teamIds: o.teamIds ?? [],
      ...(o.startTime ? { startTime: o.startTime } : {}),
      ...(o.endTime ? { endTime: o.endTime } : {}),
      ...(o.productionId ? { productionId: o.productionId } : {}),
      ...(o.maintenanceId ? { maintenanceId: o.maintenanceId } : {}),
    },
  })
}

beforeEach(async () => {
  await environment.clearFirestore()
  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Other' })

  // The editor belongs to Lighting only. Tagging Costume must still work,
  // because calendar is organization-level.
  await seedMembership(environment, { organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_CAL })
  await seedMembership(environment, { organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_CAL })
  await seedMembership(environment, { organizationId: ORG_A, uid: NO_ACCESS, teamIds: [TEAM_LIGHTING], permissions: NO_CAL })
  await seedMembership(environment, { organizationId: ORG_A, uid: DEACTIVATED, teamIds: [TEAM_LIGHTING], permissions: EDIT_CAL, isActive: false })

  await environment.withSecurityRulesDisabled(async (context) => {
    const s = context.firestore() as unknown as Firestore
    await setDoc(doc(s, 'productions', PROD_A), buildProductionDocument({
      productionId: PROD_A, organizationId: ORG_A, uid: ADMIN, now: serverTimestamp,
      input: { title: 'Spring Musical', status: 'planning' },
    }))
    await setDoc(doc(s, 'productions', PROD_B), buildProductionDocument({
      productionId: PROD_B, organizationId: ORG_B, uid: OUTSIDER, now: serverTimestamp,
      input: { title: 'Other Show', status: 'planning' },
    }))
    await setDoc(doc(s, 'calendar_events', EVENT_A), eventDoc())
    await setDoc(doc(s, 'calendar_events', EVENT_OTHER_ORG), eventDoc({
      eventId: EVENT_OTHER_ORG, organizationId: ORG_B, uid: OUTSIDER,
    }))
  })
})

describe('calendar read', () => {
  it('283. Admin reads an event', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), 'calendar_events', EVENT_A)))
  })

  it('284. calendar view member reads an event', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'calendar_events', EVENT_A)))
  })

  it('285. calendar edit member reads an event', async () => {
    await assertSucceeds(getDoc(doc(db(EDITOR), 'calendar_events', EVENT_A)))
  })

  it('286. calendar none is denied, even holding every other module', async () => {
    await assertFails(getDoc(doc(db(NO_ACCESS), 'calendar_events', EVENT_A)))
  })

  it('287. a deactivated membership is denied', async () => {
    await assertFails(getDoc(doc(db(DEACTIVATED), 'calendar_events', EVENT_A)))
  })

  it('288. another organization is denied', async () => {
    await assertFails(getDoc(doc(db(ADMIN), 'calendar_events', EVENT_OTHER_ORG)))
  })

  it('289. an unauthenticated caller is denied', async () => {
    await assertFails(getDoc(doc(db(null), 'calendar_events', EVENT_A)))
  })
})

describe('calendar queries', () => {
  function listQuery(store: Firestore, organizationId: string) {
    return query(collection(store, 'calendar_events'), where('organization_id', '==', organizationId))
  }

  it('290. the organization-wide calendar query succeeds for every role holding the module', async () => {
    for (const uid of [ADMIN, VIEWER, EDITOR]) {
      const snapshot = await assertSucceeds(getDocs(listQuery(db(uid), ORG_A)))
      expect(snapshot.size).toBe(1)
    }
  })

  it('291. another organization cannot be queried', async () => {
    await assertFails(getDocs(listQuery(db(VIEWER), ORG_B)))
  })

  it('292. an unfiltered query is rejected', async () => {
    await assertFails(getDocs(collection(db(VIEWER), 'calendar_events')))
  })

  it('293. a member with calendar none cannot query', async () => {
    await assertFails(getDocs(listQuery(db(NO_ACCESS), ORG_A)))
  })
})

describe('calendar create', () => {
  const NEW_EVENT = 'eventNEWNEWNEWNEWNE1'

  it('294. Admin creates an all-day event', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({ eventId: NEW_EVENT })))
  })

  it('295. calendar edit member creates an event', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'calendar_events', NEW_EVENT), eventDoc({ eventId: NEW_EVENT, uid: EDITOR })))
  })

  it('296. an editor may tag a team they do not belong to', async () => {
    // Calendar is organization-level. team_ids is metadata, so this must work
    // even though the editor is only on Lighting.
    await assertSucceeds(setDoc(doc(db(EDITOR), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, uid: EDITOR, visibility: 'teams', teamIds: [TEAM_COSTUME],
    })))
  })

  it('297. several teams may be tagged at once', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, uid: EDITOR, visibility: 'teams', teamIds: [TEAM_LIGHTING, TEAM_COSTUME],
    })))
  })

  it('298. calendar view member cannot create', async () => {
    await assertFails(setDoc(doc(db(VIEWER), 'calendar_events', NEW_EVENT), eventDoc({ eventId: NEW_EVENT, uid: VIEWER })))
  })

  it('299. calendar none cannot create', async () => {
    await assertFails(setDoc(doc(db(NO_ACCESS), 'calendar_events', NEW_EVENT), eventDoc({ eventId: NEW_EVENT, uid: NO_ACCESS })))
  })

  it('300. another organization cannot be targeted', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, organizationId: ORG_B,
    })))
  })

  it('301. a document ID that disagrees with event_id is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', 'eventMISMATCHMISMAT1'), eventDoc({ eventId: NEW_EVENT })))
  })

  it('302. an unknown field is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), colour: 'red',
    }))
  })

  it('303. a timed event with a start time alone is accepted', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, startTime: '19:30',
    })))
  })

  it('304. a start and end together are accepted', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, startTime: '19:30', endTime: '21:00',
    })))
  })

  it('305. an end time with no start time is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), end_time: '21:00',
    }))
  })

  it('306. an end time before the start time is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT, startTime: '21:00' }), end_time: '19:30',
    }))
  })

  it('307. a malformed clock time is rejected', async () => {
    for (const value of ['7pm', '25:00', '19:60', '1930']) {
      await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
        ...eventDoc({ eventId: NEW_EVENT }), start_time: value,
      }))
    }
  })

  it('308. a non-timestamp event date is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), event_date: '2026-08-24',
    }))
  })

  it('309. visibility teams with no teams is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), visibility: 'teams', team_ids: [],
    }))
  })

  it('310. visibility all_teams carrying teams is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), visibility: 'all_teams', team_ids: [TEAM_LIGHTING],
    }))
  })

  it('311. team_ids that is not a list is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), visibility: 'teams', team_ids: TEAM_LIGHTING,
    }))
  })

  it('312. an unsupported visibility is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), visibility: 'private',
    }))
  })

  it('313. a linked production in the same organization is accepted', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, productionId: PROD_A,
    })))
  })

  it('314. a linked production from another organization is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, productionId: PROD_B,
    })))
  })

  it('315. a nonexistent linked production is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), eventDoc({
      eventId: NEW_EVENT, productionId: 'prodDOESNOTEXIST0001',
    })))
  })

  it('316. created_by_uid naming somebody else is rejected', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'calendar_events', NEW_EVENT), eventDoc({ eventId: NEW_EVENT, uid: ADMIN })))
  })

  it('317. an empty title or event type is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), title: '',
    }))
    await assertFails(setDoc(doc(db(ADMIN), 'calendar_events', NEW_EVENT), {
      ...eventDoc({ eventId: NEW_EVENT }), event_type: '',
    }))
  })
})

describe('calendar update and delete', () => {
  it('318. Admin updates an event', async () => {
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'calendar_events', EVENT_A), {
      title: 'Final Dress', updated_at: serverTimestamp(),
    }))
  })

  it('319. calendar edit member updates an event', async () => {
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'calendar_events', EVENT_A), {
      title: 'Final Dress', updated_at: serverTimestamp(),
    }))
  })

  it('320. an editor may retag an event to a team they do not belong to', async () => {
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'calendar_events', EVENT_A), {
      visibility: 'teams', team_ids: [TEAM_COSTUME], updated_at: serverTimestamp(),
    }))
  })

  it('321. calendar view member cannot update', async () => {
    await assertFails(updateDoc(doc(db(VIEWER), 'calendar_events', EVENT_A), {
      title: 'Hijacked', updated_at: serverTimestamp(),
    }))
  })

  it('322. identity and metadata are immutable', async () => {
    for (const patch of [
      { event_id: 'eventSOMETHINGELSE01' },
      { organization_id: ORG_B },
      { created_by_uid: EDITOR },
      { created_at: serverTimestamp() },
    ]) {
      await assertFails(updateDoc(doc(db(ADMIN), 'calendar_events', EVENT_A), {
        ...patch, updated_at: serverTimestamp(),
      }))
    }
  })

  it('323. an update to a malformed time is rejected', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'calendar_events', EVENT_A), {
      start_time: '7pm', updated_at: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db(ADMIN), 'calendar_events', EVENT_A), {
      end_time: '21:00', updated_at: serverTimestamp(),
    }))
  })

  it('324. an update adding an unknown field is rejected', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'calendar_events', EVENT_A), {
      colour: 'red', updated_at: serverTimestamp(),
    }))
  })

  // Calendar is the one collection where deletion is allowed.
  it('325. Admin deletes an event', async () => {
    const s = db(ADMIN); const b = writeBatch(s)
    b.delete(doc(s, 'calendar_events', EVENT_A))
    await assertSucceeds(b.commit())
  })

  it('326. calendar edit member deletes an event', async () => {
    const s = db(EDITOR); const b = writeBatch(s)
    b.delete(doc(s, 'calendar_events', EVENT_A))
    await assertSucceeds(b.commit())
  })

  it('327. calendar view member cannot delete', async () => {
    const s = db(VIEWER); const b = writeBatch(s)
    b.delete(doc(s, 'calendar_events', EVENT_A))
    await assertFails(b.commit())
  })

  it('328. another organization event cannot be deleted', async () => {
    const s = db(ADMIN); const b = writeBatch(s)
    b.delete(doc(s, 'calendar_events', EVENT_OTHER_ORG))
    await assertFails(b.commit())
  })
})
