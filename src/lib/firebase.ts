import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { readFirebaseEnv } from '@/lib/env'

/**
 * Firebase is initialized lazily. Nothing connects at import time, so the
 * application builds and renders a configuration message when no project is set.
 */
export function getFirebaseApp(): FirebaseApp {
  const existing = getApps()
  if (existing.length > 0) {
    return getApp()
  }

  const result = readFirebaseEnv()
  if (!result.ok) {
    throw new Error(
      `Firebase is not configured. Missing environment variables: ${result.missing.join(', ')}`,
    )
  }

  return initializeApp({
    apiKey: result.env.VITE_FIREBASE_API_KEY,
    authDomain: result.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: result.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: result.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: result.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: result.env.VITE_FIREBASE_APP_ID,
  })
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

export function getFirebaseDb(): Firestore {
  return getFirestore(getFirebaseApp())
}
