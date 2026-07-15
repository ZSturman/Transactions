import { defineConfig } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/** Parse a .env file into a plain object (no dotenv dependency needed). */
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^\s*([^#\s=][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const testEnv = loadEnvFile(resolve(__dirname, ".env.test"));

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],

  webServer: [
    {
      // Firebase emulators (auth + firestore + UI for health-check endpoint)
      command:
        "firebase emulators:start --only auth,firestore,ui --project demo-test",
      url: "http://localhost:4000",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Next.js dev server with test environment variables injected.
      // Because process.env values set before Next.js starts take precedence
      // over .env.local, our test vars reliably override production config.
      command: "next dev -p 3000",
      url: "http://localhost:3000",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: testEnv,
    },
  ],
});
