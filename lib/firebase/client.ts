import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app'
import { getAuth, Auth } from 'firebase/auth'
import { getFirestore, Firestore } from 'firebase/firestore'

// Check if we're in build phase
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

// Firebase App Hosting provides FIREBASE_WEBAPP_CONFIG automatically
// For local development, use NEXT_PUBLIC_* environment variables
const getFirebaseConfig = () => {
  // Check if running on Firebase App Hosting (auto-config available)
  // The Firebase SDK's postinstall hook bakes in the config from FIREBASE_WEBAPP_CONFIG
  // When this is available, initializeApp() works without arguments

  // For local development, use explicit config
  if (process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    return {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    }
  }

  // On Firebase App Hosting, return undefined to use auto-config
  return undefined
}

// Initialize Firebase
let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

if (!isBuildPhase) {
  try {
    const config = getFirebaseConfig()

    if (getApps().length) {
      app = getApp()
    } else if (config) {
      // Local development with explicit config
      app = initializeApp(config)
    } else {
      // Firebase App Hosting with auto-config
      // initializeApp() without arguments uses FIREBASE_WEBAPP_CONFIG
      app = initializeApp()
    }

    auth = getAuth(app)
    db = getFirestore(app)
  } catch (error) {
    console.error('Firebase initialization error:', error)
    // App will work without Firebase in build phase
  }
}

export { app, auth, db }
