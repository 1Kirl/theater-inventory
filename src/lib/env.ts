import { z } from 'zod'

/**
 * Firebase web config values are public by design and ship in the client bundle.
 * They are not secrets; access control lives in Security Rules and Cloud Functions.
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
 */
export function readFirebaseEnv(): FirebaseEnvResult {
  const parsed = firebaseEnvSchema.safeParse(import.meta.env)

  if (parsed.success) {
    return { ok: true, env: parsed.data }
  }

  const missing = parsed.error.issues.map((issue) => issue.path.join('.'))
  return { ok: false, missing }
}

export function isFirebaseConfigured(): boolean {
  return readFirebaseEnv().ok
}
