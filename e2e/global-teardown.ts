/** Stop the emulator through its owning launcher before Playwright tears down
 * web servers. This lets the Firebase CLI stop the Firestore Java process. */
export default async function globalTeardown() {
  try {
    await fetch("http://127.0.0.1:4010/shutdown");
  } catch {
    // The launcher may already be gone after a setup failure.
  }
}
