import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAuth, type Auth } from 'firebase/auth'
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging'

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
}

let app: FirebaseApp
try {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig)
} catch {
  app = initializeApp(firebaseConfig)
}

export const db = getFirestore(app)
export const storage = getStorage(app)

let auth: Auth
try {
  auth = getAuth(app)
} catch {
  auth = {} as Auth
}
export { auth }

let messagingPromise: Promise<Messaging | null> | null = null

async function loadMessaging(): Promise<Messaging | null> {
  if (typeof window === 'undefined') return null

  try {
    const supported = await isSupported()
    if (!supported) return null
    return getMessaging(app)
  } catch (error) {
    console.warn('[Firebase] Messaging não suportado ou indisponível.', error)
    return null
  }
}

export function getFirebaseMessaging(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = loadMessaging()
  }
  return messagingPromise
}

export default app
