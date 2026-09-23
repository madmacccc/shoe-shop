import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
}

export const firebaseIsConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

const app = firebaseIsConfigured && getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = firebaseIsConfigured ? getAuth(app) : null
export const db = firebaseIsConfigured ? getFirestore(app) : null
export const database = firebaseIsConfigured ? getDatabase(app) : null
export const storage = firebaseIsConfigured ? getStorage(app) : null
