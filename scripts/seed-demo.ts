/**
 * Create the QA and demonstration dataset in the real Firebase project.
 *
 * This writes through the ordinary client SDK as two ordinary signed-in users,
 * so every document it creates passes the same Security Rules as one created by
 * hand in the interface. There is no Admin SDK, no service account, and no
 * privileged path: if a rule would refuse a person, it refuses this too.
 *
 * The document shapes come from the application's own payload builders, so a
 * seeded record cannot drift from a real one. The service wrappers are not used
 * because they read configuration through Vite's `import.meta.env`, which does
 * not exist in Node; this script reads .env.local itself and builds its own
 * Firebase app.
 *
 * Run:
 *   npm run seed:demo -- --confirm
 */
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut, type Auth,
  type User,
} from 'firebase/auth'
import {
  Timestamp, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc,
  where, writeBatch, getFirestore, type Firestore,
} from 'firebase/firestore'
import { COLLECTIONS, joinProofId, membershipId } from '@/domain/organization-ids'
import { normalizeUserId, toSyntheticEmail } from '@/domain/user-id'
import { generateJoinCode } from '@/domain/join-code'
import {
  buildAdminSettingsDocument, buildJoinCodeDocument, buildJoinProofDocument,
  buildMembershipDocument, buildOrganizationDocument, buildTeamDocument,
} from '@/domain/organization-payloads'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
import { buildMaintenanceDocument } from '@/domain/maintenance-payloads'
import {
  buildActionItemDocument, buildProductionDocument, buildRequirementDocument,
} from '@/domain/production-payloads'
import { buildCalendarEventDocument } from '@/domain/calendar-payloads'
import {
  DEMO_ACTIONS, DEMO_CALENDAR, DEMO_INVENTORY, DEMO_MAINTENANCE, DEMO_MEMBER_PERMISSIONS,
  DEMO_MEMBER_TEAMS, DEMO_ORGANIZATION_NAME, DEMO_PRODUCTIONS, DEMO_REQUIREMENTS, DEMO_TEAMS,
  demoConditionCounts, demoDate,
} from '@/domain/demo-dataset'
import type { Organization, OrganizationMembership } from '@/types/organization'

const CONFIRM_FLAG = '--confirm'

function readEnvFile(path: string, required: boolean): Record<string, string> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    if (required) fail(`${path} is missing. See README, "QA and demo data".`)
    return {}
  }

  return Object.fromEntries(
    raw.split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=')
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
      }),
  )
}

function fail(message: string): never {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function required(env: Record<string, string>, name: string): string {
  const value = env[name]
  if (!value) fail(`${name} is not set. Add it to .env.seed.local.`)
  return value
}

/** A timestamp for a date this many days from today, at local midnight. */
function dayOffset(today: Date, days: number): Timestamp {
  return Timestamp.fromDate(demoDate(today, days))
}

async function signInOrCreate(params: {
  auth: Auth
  db: Firestore
  userId: string
  password: string
  displayName: string
}): Promise<User> {
  const userId = normalizeUserId(params.userId)
  const email = toSyntheticEmail(userId)

  try {
    const credential = await signInWithEmailAndPassword(params.auth, email, params.password)
    console.log(`  signed in as ${userId}`)
    return credential.user
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== 'auth/invalid-credential' && code !== 'auth/user-not-found') throw error
  }

  const credential = await createUserWithEmailAndPassword(params.auth, email, params.password)
  await setDoc(doc(params.db, COLLECTIONS.users, credential.user.uid), {
    uid: credential.user.uid,
    user_id: userId,
    display_name: params.displayName,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })

  console.log(`  created account ${userId}`)
  return credential.user
}

/**
 * The demo organization, if this account already administers one by that name.
 *
 * Found the way the application finds organizations — through the caller's own
 * memberships — because listing organizations is denied to everyone, which is
 * the point of that rule.
 */
async function findDemoOrganization(
  db: Firestore,
  uid: string,
): Promise<Organization | null> {
  const memberships = await getDocs(query(
    collection(db, COLLECTIONS.memberships),
    where('uid', '==', uid),
    where('is_active', '==', true),
  ))

  for (const entry of memberships.docs) {
    const membership = entry.data() as OrganizationMembership
    const snapshot = await getDoc(
      doc(db, COLLECTIONS.organizations, membership.organization_id),
    )
    if (!snapshot.exists()) continue

    const organization = snapshot.data() as Organization
    if (organization.name === DEMO_ORGANIZATION_NAME && organization.admin_uid === uid) {
      return organization
    }
  }

  return null
}

async function main(): Promise<void> {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    fail(
      `This writes real data to the Firebase project in .env.local.\n`
      + `  Re-run with the confirmation flag:  npm run seed:demo -- ${CONFIRM_FLAG}`,
    )
  }

  const firebaseEnv = readEnvFile('.env.local', true)
  const seedEnv = readEnvFile('.env.seed.local', true)

  const app = initializeApp({
    apiKey: required(firebaseEnv, 'VITE_FIREBASE_API_KEY'),
    authDomain: required(firebaseEnv, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: required(firebaseEnv, 'VITE_FIREBASE_PROJECT_ID'),
    storageBucket: required(firebaseEnv, 'VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: required(firebaseEnv, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: required(firebaseEnv, 'VITE_FIREBASE_APP_ID'),
  })

  const auth = getAuth(app)
  const db = getFirestore(app)
  const today = new Date()

  console.log(`\nSeeding "${DEMO_ORGANIZATION_NAME}"\n`)

  // --- The Admin, and the organization itself -------------------------------
  const admin = await signInOrCreate({
    auth,
    db,
    userId: required(seedEnv, 'DEMO_ADMIN_USER_ID'),
    password: required(seedEnv, 'DEMO_ADMIN_PASSWORD'),
    displayName: seedEnv.DEMO_ADMIN_DISPLAY_NAME || 'Demo Admin',
  })

  const existing = await findDemoOrganization(db, admin.uid)
  if (existing) {
    fail(
      `"${DEMO_ORGANIZATION_NAME}" already exists for this Admin, so nothing was written.\n`
      + `  Running again would duplicate every record. Delete the organization's documents in\n`
      + `  the Firebase console first if you want a fresh dataset.`,
    )
  }

  const organizationRef = doc(collection(db, COLLECTIONS.organizations))
  const organizationId = organizationRef.id
  const joinCode = generateJoinCode()

  const creation = writeBatch(db)
  creation.set(organizationRef, buildOrganizationDocument({
    organizationId,
    name: DEMO_ORGANIZATION_NAME,
    description: 'QA and demonstration data. Not a real school.',
    uid: admin.uid,
    now: serverTimestamp,
  }))
  creation.set(
    doc(db, COLLECTIONS.memberships, membershipId(organizationId, admin.uid)),
    buildMembershipDocument({ organizationId, uid: admin.uid, now: serverTimestamp }),
  )
  creation.set(
    doc(db, COLLECTIONS.joinCodes, joinCode),
    buildJoinCodeDocument({
      organizationId,
      organizationName: DEMO_ORGANIZATION_NAME,
      uid: admin.uid,
      now: serverTimestamp,
    }),
  )
  creation.set(
    doc(db, COLLECTIONS.adminSettings, organizationId),
    buildAdminSettingsDocument({ organizationId, joinCode, now: serverTimestamp }),
  )
  await creation.commit()
  console.log(`  organization created`)

  // --- Teams ----------------------------------------------------------------
  const teamIds = new Map<string, string>()
  for (const team of DEMO_TEAMS) {
    const ref = doc(collection(db, COLLECTIONS.teams))
    await setDoc(ref, buildTeamDocument({
      teamId: ref.id, organizationId, name: team.name, now: serverTimestamp,
    }))
    teamIds.set(team.key, ref.id)
  }
  console.log(`  ${teamIds.size} teams created`)

  // --- Inventory ------------------------------------------------------------
  const itemIds = new Map<string, string>()
  for (const item of DEMO_INVENTORY) {
    const ref = doc(collection(db, COLLECTIONS.inventoryItems))
    await setDoc(ref, buildInventoryItemDocument({
      itemId: ref.id,
      organizationId,
      uid: admin.uid,
      now: serverTimestamp,
      input: {
        name: item.name,
        category: item.category,
        teamId: teamIds.get(item.team) as string,
        quantityTotal: item.quantityTotal,
        quantityAvailable: item.quantityAvailable,
        conditionCounts: demoConditionCounts(item),
        location: item.location,
        lastInspectedAt: item.inspectedDaysAgo === null
          ? null
          : dayOffset(today, -item.inspectedDaysAgo),
        notes: item.notes,
      },
    }))
    itemIds.set(item.key, ref.id)
  }
  console.log(`  ${itemIds.size} inventory items created`)

  // --- Maintenance ----------------------------------------------------------
  const repairIds = new Map<string, string>()
  for (const record of DEMO_MAINTENANCE) {
    const item = DEMO_INVENTORY.find((entry) => entry.key === record.item)
    const ref = doc(collection(db, COLLECTIONS.maintenanceRecords))

    await setDoc(ref, buildMaintenanceDocument({
      maintenanceId: ref.id,
      organizationId,
      itemId: itemIds.get(record.item) as string,
      // The historical team snapshot, taken from the item exactly as the
      // application takes it.
      teamId: teamIds.get(item?.team as string) as string,
      uid: admin.uid,
      now: serverTimestamp,
      input: {
        quantitySent: record.quantitySent,
        issueDescription: record.issueDescription,
        status: record.status,
        sentAt: record.sentDaysAgo === undefined ? null : dayOffset(today, -record.sentDaysAgo),
        expectedReturnAt: record.expectedReturnDaysAgo === undefined
          ? null
          : dayOffset(today, -record.expectedReturnDaysAgo),
        returnedAt: record.returnedDaysAgo === undefined
          ? null
          : dayOffset(today, -record.returnedDaysAgo),
        serviceProviderName: record.providerName,
        cost: record.cost ?? null,
        repairNotes: record.repairNotes,
      },
    }))
    repairIds.set(record.key, ref.id)
  }
  console.log(`  ${repairIds.size} maintenance records created`)

  // --- Productions, requirements, actions -----------------------------------
  const productionIds = new Map<string, string>()
  for (const production of DEMO_PRODUCTIONS) {
    const ref = doc(collection(db, COLLECTIONS.productions))
    await setDoc(ref, buildProductionDocument({
      productionId: ref.id,
      organizationId,
      uid: admin.uid,
      now: serverTimestamp,
      input: {
        title: production.title,
        description: production.description,
        status: production.status,
        startDate: production.startDaysFromNow === undefined
          ? null
          : dayOffset(today, production.startDaysFromNow),
        endDate: production.endDaysFromNow === undefined
          ? null
          : dayOffset(today, production.endDaysFromNow),
      },
    }))
    productionIds.set(production.key, ref.id)
  }
  console.log(`  ${productionIds.size} productions created`)

  const requirementIds = new Map<string, string>()
  for (const requirement of DEMO_REQUIREMENTS) {
    const ref = doc(collection(db, COLLECTIONS.productionRequirements))
    await setDoc(ref, buildRequirementDocument({
      requirementId: ref.id,
      organizationId,
      productionId: productionIds.get(requirement.production) as string,
      uid: admin.uid,
      now: serverTimestamp,
      input: {
        itemName: requirement.itemName,
        inventoryItemId: requirement.item ? itemIds.get(requirement.item) as string : null,
        requiredQty: requirement.requiredQty,
        teamId: teamIds.get(requirement.team) as string,
        notes: requirement.notes,
      },
    }))
    requirementIds.set(requirement.key, ref.id)
  }
  console.log(`  ${requirementIds.size} requirements created`)

  for (const action of DEMO_ACTIONS) {
    const requirement = DEMO_REQUIREMENTS.find((entry) => entry.key === action.requirement)
    const requirementId = requirementIds.get(action.requirement) as string

    // The document ID is the requirement ID; that is what allows at most one.
    await setDoc(doc(db, COLLECTIONS.actionItems, requirementId), buildActionItemDocument({
      requirementId,
      organizationId,
      productionId: productionIds.get(requirement?.production as string) as string,
      itemName: requirement?.itemName as string,
      teamId: teamIds.get(requirement?.team as string) as string,
      uid: admin.uid,
      now: serverTimestamp,
      input: {
        actionType: action.actionType,
        quantity: action.quantity,
        status: action.status,
        dueDate: action.dueDaysFromNow === undefined
          ? null
          : dayOffset(today, action.dueDaysFromNow),
        notes: action.notes,
      },
    }))
  }
  console.log(`  ${DEMO_ACTIONS.length} action items created`)

  // --- Calendar -------------------------------------------------------------
  for (const event of DEMO_CALENDAR) {
    const ref = doc(collection(db, COLLECTIONS.calendarEvents))
    await setDoc(ref, buildCalendarEventDocument({
      eventId: ref.id,
      organizationId,
      uid: admin.uid,
      now: serverTimestamp,
      input: {
        title: event.title,
        eventType: event.eventType,
        eventDate: dayOffset(today, event.daysFromNow),
        startTime: event.startTime,
        endTime: event.endTime,
        visibility: event.teams.length === 0 ? 'all_teams' : 'teams',
        teamIds: event.teams.map((key) => teamIds.get(key) as string),
        productionId: event.production ? productionIds.get(event.production) ?? null : null,
        maintenanceId: event.maintenance ? repairIds.get(event.maintenance) ?? null : null,
        notes: event.notes,
      },
    }))
  }
  console.log(`  ${DEMO_CALENDAR.length} calendar events created`)

  // --- The Member joins with the code, then the Admin assigns them ----------
  await signOut(auth)
  const member = await signInOrCreate({
    auth,
    db,
    userId: required(seedEnv, 'DEMO_MEMBER_USER_ID'),
    password: required(seedEnv, 'DEMO_MEMBER_PASSWORD'),
    displayName: seedEnv.DEMO_MEMBER_DISPLAY_NAME || 'Demo Member',
  })

  const membershipRef = doc(db, COLLECTIONS.memberships, membershipId(organizationId, member.uid))
  const alreadyJoined = await getDoc(membershipRef).catch(() => null)

  if (!alreadyJoined?.exists()) {
    // The ordinary join: membership and proof in one batch, which is what the
    // rule for creating a membership requires.
    const joining = writeBatch(db)
    joining.set(membershipRef, buildMembershipDocument({
      organizationId, uid: member.uid, now: serverTimestamp,
    }))
    joining.set(
      doc(db, COLLECTIONS.joinProofs, joinProofId(organizationId, member.uid)),
      buildJoinProofDocument({
        organizationId, uid: member.uid, joinCode, now: serverTimestamp,
      }),
    )
    await joining.commit()
    console.log('  member joined with the organization code')
  }

  await signOut(auth)
  await signInWithEmailAndPassword(
    auth,
    toSyntheticEmail(normalizeUserId(required(seedEnv, 'DEMO_ADMIN_USER_ID'))),
    required(seedEnv, 'DEMO_ADMIN_PASSWORD'),
  )

  await updateDoc(membershipRef, {
    team_ids: DEMO_MEMBER_TEAMS.map((key) => teamIds.get(key) as string),
    permissions: DEMO_MEMBER_PERMISSIONS,
    updated_at: serverTimestamp(),
  })
  console.log('  member assigned teams and permissions')

  await signOut(auth)

  console.log(`\nDone. Sign in as either demo account and open the organization.`)
  console.log(`The organization's join code is visible to the Admin in Organization Settings.\n`)
  process.exit(0)
}

main().catch((error: unknown) => {
  const code = (error as { code?: string }).code
  console.error(`\n  Seeding failed${code ? ` (${code})` : ''}: ${(error as Error).message}\n`)
  process.exit(1)
})
