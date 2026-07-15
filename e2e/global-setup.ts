/**
 * Playwright global setup — runs once after the web servers are confirmed up,
 * before any test file executes.
 *
 * Clears all emulator data so each test suite starts from a clean slate.
 */

const PROJECT_ID = "demo-test";

export default async function globalSetup() {
  await clearAllEmulatorData();
}

async function clearAllEmulatorData() {
  await Promise.all([
    fetch(
      `http://localhost:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: "DELETE" }
    ),
    fetch(
      `http://localhost:9099/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: "DELETE" }
    ),
  ]);
}
