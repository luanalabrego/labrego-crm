// src/lib/firebaseAdmin.ts
import admin from 'firebase-admin'

let db: FirebaseFirestore.Firestore | null = null
let auth: admin.auth.Auth | null = null
let storage: admin.storage.Storage | null = null

function initAdmin() {
  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
    FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  } = process.env

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      'Missing Firebase Admin credentials in environment variables. ' +
        'Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.'
    )
  }

  const storageBucket = FIREBASE_STORAGE_BUCKET || NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET

  if (!storageBucket) {
    throw new Error(
      'Missing Firebase Storage bucket. Please set FIREBASE_STORAGE_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.'
    )
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      storageBucket,
    })
  }
}

export function getAdminDb(): FirebaseFirestore.Firestore {
  if (db) return db
  initAdmin()
  db = admin.firestore()
  db.settings({ ignoreUndefinedProperties: true })
  return db
}

export function getAdminAuth(): admin.auth.Auth {
  if (auth) return auth
  initAdmin()
  auth = admin.auth()
  return auth
}

export function getAdminStorage(): admin.storage.Storage {
  if (storage) return storage
  initAdmin()
  storage = admin.storage()
  return storage
}
