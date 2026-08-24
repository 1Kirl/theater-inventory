import { z } from 'zod'

/**
 * Firebase web config values are public by design and ship in the client bundle.
 * They are not secrets. Firestore Security Rules are the only authorization boundary; this
 * project runs on the Spark plan and has no server code behind them.
 */
const firebaseEnvSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().min(1),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
  VITE_FIREBASE_APP_ID: z.string().min(1),
})

export type FirebaseEnv = z.infer<typeof firebaseEnvSchema>

export type FirebaseEnvResult =
  | { ok: true; env: FirebaseEnv }
  | { ok: false; missing: string[] }

/**
 * Read and validate Firebase configuration from the environment.
 *
 * Returns a result rather than throwing so the application can start and render
 * a clear message while no Firebase project is connected yet.
 *
 * Each variable is named explicitly instead of handing the whole
 * `import.meta.env` to the schema. Vite replaces a bare `import.meta.env` with
 * an object literal holding *every* `VITE_` variable it loaded, so that form
 * would bake unrelated values — including a development-only App Check debug
 * token sitting in .env.local — into whatever bundle happens to be built next.
 */
export function readFirebaseEnv(): FirebaseEnvResult {
  const parsed = firebaseEnvSchema.safeParse({
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
  })

  if (parsed.success) {
    return { ok: true, env: parsed.data }
  }

  const missing = parsed.error.issues.map((issue) => issue.path.join('.'))
  return { ok: false, missing }
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseEnv().ok
}

const optionalKey = z.string().min(1).optional()

/**
 * The reCAPTCHA Enterprise site key for the production build.
 *
 * Embedded in the page by design, like the values above, and not a secret.
 * Optional here so that a missing key surfaces as an App Check problem rather
 * than as "Firebase is not configured".
 */
export function readAppCheckSiteKey(): string | undefined {
  const parsed = optionalKey.safeParse(import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY)
  return parsed.success ? parsed.data : undefined
}

/**
 * An already-registered App Check debug token, pinned instead of letting the SDK
 * generate a new one. A second browser profile needs this; a single one does not.
 *
 * **Call this only from inside an `import.meta.env.DEV` branch.** A debug token
 * is a secret — it lets any caller pass App Check for this project — and the
 * reference is what makes Vite inline the value. Kept in its own function so
 * that dead-code elimination drops the literal from production builds along
 * with the branch that reads it.
 */
export function readAppCheckDebugToken(): string | undefined {
  const parsed = optionalKey.safeParse(import.meta.env.VITE_APP_CHECK_DEBUG_TOKEN)
  return parsed.success ? parsed.data : undefined
}
