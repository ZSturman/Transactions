import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export class FirebaseAdminUnavailableError extends Error {
  constructor() {
    super("Firebase Admin credentials are not configured");
    this.name = "FirebaseAdminUnavailableError";
  }
}

/**
 * Lazily initialise the server-only Firebase Admin SDK. Vercel receives the
 * credentials via environment variables; the no-credential branch is only for
 * the Firebase emulators used by the local end-to-end suite.
 */
export function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!;

  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId) throw new FirebaseAdminUnavailableError();

  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  }

  // The Admin SDK talks directly to the emulators and does not need a service
  // account there. Never enable this fallback in a deployed environment.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId });
  }

  throw new FirebaseAdminUnavailableError();
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}
