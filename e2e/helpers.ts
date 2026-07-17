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
const RESEND_SINK = "http://127.0.0.1:3021";

// ---------------------------------------------------------------------------
// Emulator teardown
// ---------------------------------------------------------------------------

/** Delete all Firestore documents and Auth accounts. Call in beforeEach. */
export async function clearAllEmulatorData(): Promise<void> {
  await Promise.all([
    fetch(FS_EMULATOR, { method: "DELETE" }),
    fetch(AUTH_EMULATOR, { method: "DELETE" }),
    clearCapturedEmails(),
  ]);
}

// ---------------------------------------------------------------------------
// Local Resend sink
// ---------------------------------------------------------------------------

export interface CapturedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}

export async function clearCapturedEmails(): Promise<void> {
  const response = await fetch(`${RESEND_SINK}/emails`, { method: "DELETE" });
  if (!response.ok) throw new Error(`clearCapturedEmails failed: ${response.status}`);
}

export async function getCapturedEmails(): Promise<CapturedEmail[]> {
  const response = await fetch(`${RESEND_SINK}/emails`);
  if (!response.ok) throw new Error(`getCapturedEmails failed: ${response.status}`);
  const body = (await response.json()) as { emails?: CapturedEmail[] };
  return body.emails ?? [];
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
function bool(v: boolean): FsValue { return { booleanValue: v }; }
function ts(v?: Date): FsValue { return { timestampValue: (v ?? new Date()).toISOString() }; }
function arr(...items: FsValue[]): FsValue { return { arrayValue: { values: items } }; }
function mapVal(fields: Record<string, FsValue>): FsValue { return { mapValue: { fields } }; }

function fromFsValue(value: FsValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(fromFsValue);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields).map(([key, nested]) => [key, fromFsValue(nested)])
    );
  }
  return undefined;
}

/** Read a Firestore document through the emulator admin endpoint for assertions. */
export async function getFirestoreDocument(
  path: string
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`getFirestoreDocument(${path}) failed: ${response.status}`);
  const body = (await response.json()) as { fields?: Record<string, FsValue> };
  return Object.fromEntries(
    Object.entries(body.fields ?? {}).map(([key, value]) => [key, fromFsValue(value)])
  );
}

/** List a Firestore subcollection through the emulator admin endpoint for assertions. */
export async function listFirestoreDocuments(
  path: string
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const response = await fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (!response.ok) throw new Error(`listFirestoreDocuments(${path}) failed: ${response.status}`);
  const body = (await response.json()) as {
    documents?: Array<{ name: string; fields?: Record<string, FsValue> }>;
  };
  return (body.documents ?? []).map((document) => ({
    id: document.name.split("/").at(-1) ?? "",
    data: Object.fromEntries(
      Object.entries(document.fields ?? {}).map(([key, value]) => [key, fromFsValue(value)])
    ),
  }));
}

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

/** Create a pair document. */
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
  status?: "active" | "pending" | "removed";
  hidden?: boolean;
}): Promise<void> {
  const fields: Record<string, FsValue> = {
    users: arr(str(opts.user1Id), str(opts.user2Id ?? "")),
    userEmails: arr(str(opts.user1Email), str(opts.user2Email)),
    userNames: arr(str(opts.user1Name), str(opts.user2Name ?? "")),
    balance: int(opts.balance ?? 0),
    currency: str(opts.currency ?? "USD"),
    status: str(opts.status ?? "active"),
    createdAt: ts(),
    updatedAt: ts(),
  };
  if (opts.hidden !== undefined) fields.hidden = bool(opts.hidden);
  await patchDoc(`pairs/${opts.id}`, fields);
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
  expiresAt?: Date;
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
  if (opts.expiresAt) fields.expiresAt = ts(opts.expiresAt);
  await patchDoc(`invites/${opts.id}`, fields);
}

/** Create a transaction document inside a pair's subcollection. */
export async function createTransaction(opts: {
  id: string;
  pairId: string;
  amount: number;
  type: "payment" | "request" | "adjustment" | "settlement" | "forgiveness";
  description?: string;
  createdBy: string;
  status?: "pending" | "approved" | "disputed";
  balanceAtRequest?: number;
  archived?: boolean;
  /** User-facing event date, which may differ from when the record was created. */
  date?: Date;
  createdAt?: Date;
}): Promise<void> {
  const fields: Record<string, FsValue> = {
    pairId: str(opts.pairId),
    amount: int(opts.amount),
    type: str(opts.type),
    description: str(opts.description ?? ""),
    createdBy: str(opts.createdBy),
    status: str(opts.status ?? "pending"),
    createdAt: ts(opts.createdAt),
  };
  if (opts.balanceAtRequest !== undefined) fields.balanceAtRequest = int(opts.balanceAtRequest);
  if (opts.date) fields.date = ts(opts.date);
  if (opts.archived !== undefined) fields.archived = bool(opts.archived);
  await patchDoc(`pairs/${opts.pairId}/transactions/${opts.id}`, fields);
}

/** Create a balance-history point for chart-focused tests. */
export async function createBalanceSnapshot(opts: {
  id: string;
  pairId: string;
  balance: number;
  triggeredBy: string;
  reason?: string;
  timestamp?: Date;
}): Promise<void> {
  await patchDoc(`pairs/${opts.pairId}/balanceSnapshots/${opts.id}`, {
    balance: int(opts.balance),
    timestamp: ts(opts.timestamp),
    triggeredBy: str(opts.triggeredBy),
    reason: str(opts.reason ?? "test"),
  });
}

// ---------------------------------------------------------------------------
// Notification route mock
// ---------------------------------------------------------------------------

export interface NotificationCall {
  type: string;
  params: Record<string, unknown>;
}

/**
 * Intercepts notification requests at the server route boundary. The browser
 * should only send a resource ID and notification type; addresses and copy are
 * derived by the authenticated server route in production.
 */
export function captureEmailCalls(page: Page): { calls: NotificationCall[] } {
  const calls: NotificationCall[] = [];
  page.route("**/api/send-email", async (route: Route) => {
    try {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const type = String(body.type ?? "");
      calls.push({
        type,
        params: body as Record<string, unknown>,
      });
    } catch {
      // Non-JSON or unexpected body — still fulfill so the app doesn't error
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ delivered: true }),
    });
  });
  return { calls };
}

/** Capture browser-visible Firebase failures that should never reach the user. */
export function trackFirebaseFailures(page: Page): {
  permissionErrors: string[];
  authLookupFailures: string[];
} {
  const permissionErrors: string[] = [];
  const authLookupFailures: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("permission-denied")) {
      permissionErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() === 400 && response.url().includes("accounts:lookup")) {
      authLookupFailures.push(response.url());
    }
  });

  return { permissionErrors, authLookupFailures };
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
