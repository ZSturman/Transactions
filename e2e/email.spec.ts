/**
 * Notification route tests. The client may only request a server-derived
 * notification for the resource it just changed; Resend delivery itself is
 * performed by the authenticated route in production.
 */

import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createUserProfile,
  createPair,
  createTransaction,
  captureEmailCalls,
  loginViaUI,
  registerViaUI,
} from "./helpers";

async function setupPair() {
  const [userA, userB] = await Promise.all([
    createAuthUser("alice@email-test.com", "password123"),
    createAuthUser("bob@email-test.com", "password123"),
  ]);
  await Promise.all([
    createUserProfile({ uid: userA.uid, email: userA.email, displayName: "Alice" }),
    createUserProfile({ uid: userB.uid, email: userB.email, displayName: "Bob" }),
  ]);
  const pairId = "email-test-pair";
  await createPair({
    id: pairId,
    user1Id: userA.uid,
    user1Email: "alice@email-test.com",
    user1Name: "Alice",
    user2Id: userB.uid,
    user2Email: "bob@email-test.com",
    user2Name: "Bob",
    status: "active",
  });
  return { userA, userB, pairId };
}

test.describe("Email notification requests", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  // ── New transaction ──────────────────────────────────────────────────────

  test("recording a new transaction requests a transaction notification", async ({
    page,
  }) => {
    const { pairId } = await setupPair();
    const { calls } = captureEmailCalls(page);

    await loginViaUI(page, { email: "alice@email-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "+ Transaction" }).click();
    await page.getByPlaceholder("0.00").fill("25");
    await page.getByRole("button", { name: "Record Transaction" }).click();

    await expect(
      page.getByText("Transaction recorded — waiting for approval")
    ).toBeVisible({ timeout: 8_000 });

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("transaction");
  });

  // ── Approve transaction ──────────────────────────────────────────────────

  test("approving a transaction requests a resolution notification", async ({
    page,
    browser,
  }) => {
    const { userA, userB, pairId } = await setupPair();

    await createTransaction({
      id: "approve-email-tx",
      pairId,
      amount: 100,
      type: "payment",
      description: "Test",
      createdBy: userA.uid,
      status: "pending",
    });

    // User B approves — the email goes back to User A
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const { calls } = captureEmailCalls(pageB);

    await loginViaUI(pageB, { email: "bob@email-test.com", password: "password123" });
    await pageB.goto(`/pair/${pairId}`);
    await pageB.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(
      pageB.getByText("Transaction approved — balance updated!")
    ).toBeVisible({ timeout: 8_000 });

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("resolved");

    await ctxB.close();
  });

  // ── Dispute transaction ──────────────────────────────────────────────────

  test("disputing a transaction requests a resolution notification", async ({
    page,
    browser,
  }) => {
    const { userA, userB, pairId } = await setupPair();

    await createTransaction({
      id: "dispute-email-tx",
      pairId,
      amount: 75,
      type: "request",
      description: "Groceries",
      createdBy: userA.uid,
      status: "pending",
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const { calls } = captureEmailCalls(pageB);

    await loginViaUI(pageB, { email: "bob@email-test.com", password: "password123" });
    await pageB.goto(`/pair/${pairId}`);
    await pageB.getByRole("button", { name: "Dispute", exact: true }).click();
    await pageB.getByPlaceholder("Reason for dispute\u2026").fill("Incorrect amount");
    await pageB.getByRole("button", { name: "Submit Dispute" }).click();

    await expect(
      pageB.getByText("Transaction disputed — creator notified")
    ).toBeVisible({ timeout: 8_000 });

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("resolved");

    await ctxB.close();
  });

  // ── Invite ───────────────────────────────────────────────────────────────

  test("sending an invite requests an invitation notification", async ({
    page,
  }) => {
    await registerViaUI(page, {
      name: "Carol",
      email: "carol@email-test.com",
      password: "password123",
    });

    const { calls } = captureEmailCalls(page);

    await page.getByRole("button", { name: "+ Transaction" }).first().click();
    await page.getByRole("button", { name: "+ Connect with someone new" }).click();
    await page
      .getByPlaceholder("Their email address")
      .fill("dave@email-test.com");
    await page.getByPlaceholder("0.00").fill("25");
    await page.getByRole("button", { name: "Send Invite & Record Transaction" }).click();

    await expect(page.getByText("Invite saved!")).toBeVisible({ timeout: 8_000 });

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("invite");
  });

  // ── Exhaustive notification-type check ───────────────────────────────────

  test("only supported notification types are requested", async ({
    page,
    browser,
  }) => {
    const { userA, userB, pairId } = await setupPair();

    await createTransaction({
      id: "all-email-tx",
      pairId,
      amount: 60,
      type: "payment",
      description: "Lunch",
      createdBy: userA.uid,
      status: "pending",
    });

    // Collect notification requests for both users
    const allCalls: string[] = [];

    // User A creates another transaction (email to Bob)
    const { calls: callsA } = captureEmailCalls(page);
    await loginViaUI(page, { email: "alice@email-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "+ Transaction" }).click();
    await page.getByPlaceholder("0.00").fill("15");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    await page.getByText("Transaction recorded").waitFor({ timeout: 8_000 });
    allCalls.push(...callsA.map((c) => c.type));

    // User B approves the pre-created transaction (email to Alice)
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    const { calls: callsB } = captureEmailCalls(pageB);
    await loginViaUI(pageB, { email: "bob@email-test.com", password: "password123" });
    await pageB.goto(`/pair/${pairId}`);
    await pageB.getByRole("button", { name: "Approve", exact: true }).first().click();
    await pageB.getByText("Transaction approved").waitFor({ timeout: 8_000 });
    allCalls.push(...callsB.map((c) => c.type));
    await ctxB.close();

    for (const type of allCalls) {
      expect(["transaction", "resolved", "invite"]).toContain(type);
    }
  });
});
