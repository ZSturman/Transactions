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

const testEnv = {
  ...loadEnvFile(resolve(__dirname, ".env.test")),
  // Route Resend through a local sink so the suite exercises the actual
  // authenticated server route and can inspect the generated email HTML.
  RESEND_API_KEY: "test-resend-key",
  RESEND_BASE_URL: "http://127.0.0.1:3021",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    ...(chromiumExecutable
      ? { launchOptions: { executablePath: chromiumExecutable } }
      : {}),
  },

  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],

  webServer: [
    {
      command: "node e2e/resend-sink.mjs",
      url: "http://127.0.0.1:3021/health",
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The Firebase CLI version used locally does not expose the Emulator UI.
      // This launcher waits for Firestore and serves a dedicated health endpoint.
      command: "node e2e/start-emulators.mjs",
      url: "http://127.0.0.1:4010/health",
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
