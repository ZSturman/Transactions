/**
 * Shared helpers for Transactions e2e tests.
 *
 * These functions interact with the Firebase Emulator REST APIs directly so
 * tests can set up state (users, pairs, transactions) without going through
 * the UI every time — keeping suites fast and focused.
 */

import type { Page, Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ID = "demo-test";
const FS_BASE = `http://localhost:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FS_EMULATOR = `http://localhost:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_EMULATOR = `http://localhost:9099/emulator/v1/projects/${PROJECT_ID}/accounts`;
const AUTH_SIGNUP = `http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`;

// ---------------------------------------------------------------------------
// Emulator teardown
// ---------------------------------------------------------------------------

/** Delete all Firestore documents and Auth accounts. Call in beforeEach. */
export async function clearAllEmulatorData(): Promise<void> {
  await Promise.all([
    fetch(FS_EMULATOR, { method: "DELETE" }),
    fetch(AUTH_EMULATOR, { method: "DELETE" }),
  ]);
}

// ---------------------------------------------------------------------------
// Firestore field-value builders (matching the Firestore REST wire format)
// ---------------------------------------------------------------------------

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { arrayValue: { values: FsValue[] } }
  | { mapValue: { fields: Record<string, FsValue> } }
  | { nullValue: null };

function str(v: string): FsValue { return { stringValue: v }; }
function int(v: number): FsValue { return { integerValue: String(v) }; }
function dbl(v: number): FsValue { return { doubleValue: v }; }
function ts(v?: Date): FsValue { return { timestampValue: (v ?? new Date()).toISOString() }; }
function arr(...items: FsValue[]): FsValue { return { arrayValue: { values: items } }; }
function mapVal(fields: Record<string, FsValue>): FsValue { return { mapValue: { fields } }; }

async function patchDoc(
  path: string,
  fields: Record<string, FsValue>
): Promise<void> {
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      // "owner" is the Firestore emulator's bypass token for demo-* projects —
      // it grants admin access and skips security rules.
      "Authorization": "Bearer owner",
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`patchDoc(${path}) failed ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Auth emulator helpers
// ---------------------------------------------------------------------------

export interface AuthUser {
  uid: string;
  email: string;
}

/** Create a user in the Auth emulator and return their uid. */
export async function createAuthUser(
  email: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(AUTH_SIGNUP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.localId) {
    throw new Error(`createAuthUser failed: ${JSON.stringify(data)}`);
  }
  return { uid: data.localId, email };
}

// ---------------------------------------------------------------------------
// Firestore document creators
// ---------------------------------------------------------------------------

/** Create a user profile document (mirrors what AuthContext.ensureUserDoc writes). */
export async function createUserProfile(opts: {
  uid: string;
  email: string;
  displayName: string;
  currency?: string;
}): Promise<void> {
  await patchDoc(`users/${opts.uid}`, {
    uid: str(opts.uid),
    email: str(opts.email),
    displayName: str(opts.displayName),
    photoURL: str(""),
    currency: str(opts.currency ?? "USD"),
    createdAt: ts(),
  });
}

/** Create an active or pending pair document. */
export async function createPair(opts: {
  id: string;
  user1Id: string;
  user1Email: string;
  user1Name: string;
  user2Id?: string;
  user2Email: string;
  user2Name?: string;
  balance?: number;
  currency?: string;
  status?: "active" | "pending";
}): Promise<void> {
  await patchDoc(`pairs/${opts.id}`, {
    users: arr(str(opts.user1Id), str(opts.user2Id ?? "")),
    userEmails: arr(str(opts.user1Email), str(opts.user2Email)),
    userNames: arr(str(opts.user1Name), str(opts.user2Name ?? "")),
    balance: int(opts.balance ?? 0),
    currency: str(opts.currency ?? "USD"),
    status: str(opts.status ?? "active"),
    createdAt: ts(),
    updatedAt: ts(),
  });
}

/** Create an invite document. */
export async function createInvite(opts: {
  id: string;
  fromUid: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  pairId: string;
  pendingTransaction?: {
    amount: number;
    type: string;
    description: string;
    date: string;
  };
}): Promise<void> {
  const fields: Record<string, FsValue> = {
    fromUid: str(opts.fromUid),
    fromEmail: str(opts.fromEmail),
    fromName: str(opts.fromName),
    toEmail: str(opts.toEmail),
    pairId: str(opts.pairId),
    status: str("pending"),
    createdAt: ts(),
  };
  if (opts.pendingTransaction) {
    const pt = opts.pendingTransaction;
    fields.pendingTransaction = mapVal({
      amount: dbl(pt.amount),
      type: str(pt.type),
      description: str(pt.description),
      date: str(pt.date),
    });
  }
  await patchDoc(`invites/${opts.id}`, fields);
}

/** Create a transaction document inside a pair's subcollection. */
export async function createTransaction(opts: {
  id: string;
  pairId: string;
  amount: number;
  type: "payment" | "request";
  description?: string;
  createdBy: string;
  status?: "pending" | "approved" | "disputed";
}): Promise<void> {
  await patchDoc(`pairs/${opts.pairId}/transactions/${opts.id}`, {
    pairId: str(opts.pairId),
    amount: int(opts.amount),
    type: str(opts.type),
    description: str(opts.description ?? ""),
    createdBy: str(opts.createdBy),
    status: str(opts.status ?? "pending"),
    createdAt: ts(),
  });
}

// ---------------------------------------------------------------------------
// EmailJS mock
// ---------------------------------------------------------------------------

export interface EmailJSCall {
  templateId: string;
  serviceId: string;
  params: Record<string, unknown>;
}

/**
 * Intercepts all requests to api.emailjs.com on the given page and records
 * the template_id of each send call. Returns the mutable `calls` array so
 * tests can assert on it after actions.
 */
export function captureEmailCalls(page: Page): { calls: EmailJSCall[] } {
  const calls: EmailJSCall[] = [];
  page.route("**/api.emailjs.com/**", async (route: Route) => {
    try {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      calls.push({
        templateId: String(body.template_id ?? ""),
        serviceId: String(body.service_id ?? ""),
        params: (body.template_params as Record<string, unknown>) ?? {},
      });
    } catch {
      // Non-JSON or unexpected body — still fulfill so the app doesn't error
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: 200, text: "OK" }),
    });
  });
  return { calls };
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/** Fill the register form and wait for redirect to /. */
export async function registerViaUI(
  page: Page,
  opts: { name: string; email: string; password: string }
): Promise<void> {
  await page.goto("/register");
  await page.locator('[autocomplete="name"]').fill(opts.name);
  await page.locator('[autocomplete="email"]').fill(opts.email);
  await page.locator('[autocomplete="new-password"]').fill(opts.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("/");
}

/** Fill the login form and wait for redirect to /. */
export async function loginViaUI(
  page: Page,
  opts: { email: string; password: string }
): Promise<void> {
  await page.goto("/login");
  await page.locator('[autocomplete="email"]').fill(opts.email);
  await page.locator('[autocomplete="current-password"]').fill(opts.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}
