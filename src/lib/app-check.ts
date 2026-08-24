import type { FirebaseApp } from 'firebase/app'
import {
  CustomProvider, ReCaptchaEnterpriseProvider, initializeAppCheck, type AppCheck,
} from 'firebase/app-check'
import { readAppCheckDebugToken, readAppCheckSiteKey } from '@/lib/env'

/**
 * App Check initialization.
 *
 * Enforcement is on in the Firebase console, so a request without a valid App
 * Check token is rejected by the service rather than by our code. That makes
 * this module part of getting the app to work at all, not a defence in depth.
 *
 * Two providers, chosen at build time:
 *
 * - Production uses reCAPTCHA Enterprise with the registered site key.
 * - Development uses the SDK's debug provider, enabled by the global
 *   `FIREBASE_APPCHECK_DEBUG_TOKEN` flag, so localhost never has to be added to
 *   the production reCAPTCHA key.
 *
 * `import.meta.env.DEV` is replaced by a literal at build time, so the debug
 * branch is eliminated from the production bundle. It is not a runtime check
 * that could be flipped by a stray environment value.
 */

let appCheck: AppCheck | null = null
let failed = false

/**
 * Placeholder provider for debug mode.
 *
 * `initializeAppCheck` requires a provider and calls `provider.initialize()`
 * unconditionally, but in debug mode the token comes from the debug exchange
 * endpoint and this provider's `getToken` is never reached. `CustomProvider`
 * makes that harmless: its `initialize` only stores the app, where
 * `ReCaptchaEnterpriseProvider` would load the reCAPTCHA script and call the
 * production site key from localhost.
 *
 * Throwing here means that if debug mode were ever not active, App Check fails
 * rather than quietly issuing something.
 */
function debugPlaceholderProvider(): CustomProvider {
  return new CustomProvider({
    getToken: () =>
      Promise.reject(
        new Error(
          'App Check debug mode is not active. The debug provider issues no token of its own.',
        ),
      ),
  })
}

/**
 * Initialize App Check once for the given app.
 *
 * Called from `getFirebaseApp()` so it runs before Auth, Firestore, or AI Logic
 * can send a request. Safe to call repeatedly.
 */
export function ensureAppCheck(app: FirebaseApp): AppCheck | null {
  if (appCheck || failed) return appCheck
  // App Check needs a browser: it reads globals and stores its debug token in
  // IndexedDB. Node-based tests never reach this.
  if (typeof window === 'undefined') return null

  if (import.meta.env.DEV) {
    const debugToken = readAppCheckDebugToken()

    // Must be set before initializeAppCheck: the SDK reads it once, on the
    // first call. `true` makes it generate and persist a token; a string pins
    // one that is already registered.
    const globals = self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | true }
    globals.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken ?? true

    appCheck = initializeAppCheck(app, {
      provider: debugPlaceholderProvider(),
      isTokenAutoRefreshEnabled: true,
    })

    // The SDK prints the token itself; repeating it here would put a value the
    // SDK calls a secret into a second place.
    console.info(
      debugToken
        ? '[App Check] Debug provider active with the token from VITE_APP_CHECK_DEBUG_TOKEN.'
        : '[App Check] Debug provider active. Register the token logged below under'
          + ' App Check → Manage debug tokens.',
    )

    return appCheck
  }

  const siteKey = readAppCheckSiteKey()
  if (!siteKey) {
    // Loud, because enforcement is on: every AI Logic call will be rejected.
    console.error(
      '[App Check] VITE_FIREBASE_APP_CHECK_SITE_KEY is not set. App Check is enforced,'
        + ' so requests from this build will be rejected.',
    )
    failed = true
    return null
  }

  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })

  return appCheck
}
