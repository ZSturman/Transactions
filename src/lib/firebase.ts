import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, Auth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, Firestore, connectFirestoreEmulator } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

function getFirebaseApp(): FirebaseApp {
  return getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
}

let _auth: Auth | undefined;
let _db: Firestore | undefined;
let _authEmulatorConnected = false;
let _dbEmulatorConnected = false;

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    _auth = getAuth(getFirebaseApp());
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true" && !_authEmulatorConnected) {
      connectAuthEmulator(_auth, "http://localhost:9099", { disableWarnings: true });
      _authEmulatorConnected = true;
    }
  }
  return _auth;
}

export function getFirebaseDb(): Firestore {
  if (!_db) {
    _db = getFirestore(getFirebaseApp());
    if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true" && !_dbEmulatorConnected) {
      connectFirestoreEmulator(_db, "localhost", 8080);
      _dbEmulatorConnected = true;
    }
  }
  return _db;
}

// Convenience exports for use in client components
export const auth = typeof window !== "undefined" ? getFirebaseAuth() : (null as unknown as Auth);
export const db = typeof window !== "undefined" ? getFirebaseDb() : (null as unknown as Firestore);
export const googleProvider = typeof window !== "undefined" ? new GoogleAuthProvider() : (null as unknown as GoogleAuthProvider);
