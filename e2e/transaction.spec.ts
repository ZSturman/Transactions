import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createUserProfile,
  createPair,
  createTransaction,
  captureEmailCalls,
  loginViaUI,
} from "./helpers";

/** Shared fixture: two users and an active pair between them. */
async function setupPair() {
  const [userA, userB] = await Promise.all([
    createAuthUser("alice@tx-test.com", "password123"),
    createAuthUser("bob@tx-test.com", "password123"),
  ]);
  await Promise.all([
    createUserProfile({ uid: userA.uid, email: userA.email, displayName: "Alice" }),
    createUserProfile({ uid: userB.uid, email: userB.email, displayName: "Bob" }),
  ]);

  const pairId = "tx-test-pair";
  await createPair({
    id: pairId,
    user1Id: userA.uid,
    user1Email: "alice@tx-test.com",
    user1Name: "Alice",
    user2Id: userB.uid,
    user2Email: "bob@tx-test.com",
    user2Name: "Bob",
    status: "active",
  });

  return { userA, userB, pairId };
}

test.describe("Transaction flow", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("User A can record a transaction which appears as pending for User B", async ({
    page,
    browser,
  }) => {
    const { userA, userB, pairId } = await setupPair();

    // User A records the transaction
    captureEmailCalls(page);
    await loginViaUI(page, { email: "alice@tx-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);

    await page.getByRole("button", { name: "+ Transaction" }).click();
    await page.getByPlaceholder("0.00").fill("42");
    await page.getByRole("button", { name: "Record Transaction" }).click();

    // Success toast
    await expect(
      page.getByText("Transaction recorded — waiting for approval")
    ).toBeVisible({ timeout: 8_000 });

    // User B opens the pair page and sees the pending badge
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginViaUI(pageB, { email: "bob@tx-test.com", password: "password123" });
    await pageB.goto(`/pair/${pairId}`);

    await expect(pageB.getByText("1 pending")).toBeVisible({ timeout: 8_000 });
    await expect(pageB.locator(".bg-yellow-100").first()).toBeVisible();

    await ctxB.close();
  });

  test("User B can approve a pending transaction which updates the balance", async ({
    page,
    browser,
  }) => {
    const { userA, userB, pairId } = await setupPair();

    // Create a pending transaction already in Firestore
    await createTransaction({
      id: "approve-test-tx",
      pairId,
      amount: 50,
      type: "payment",
      description: "Dinner",
      createdBy: userA.uid,
      status: "pending",
    });

    // User B logs in and approves
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    captureEmailCalls(pageB);
    await loginViaUI(pageB, { email: "bob@tx-test.com", password: "password123" });
    await pageB.goto(`/pair/${pairId}`);

    await pageB.getByRole("button", { name: "Approve", exact: true }).click();

    await expect(
      pageB.getByText("Transaction approved — balance updated!")
    ).toBeVisible({ timeout: 8_000 });

    // Status badge should switch from "pending" to "approved"
    await expect(pageB.locator(".bg-green-100").first()).toBeVisible({ timeout: 8_000 });

    await ctxB.close();
  });

  test("User B can dispute a transaction with a reason", async ({
    page,
    browser,
  }) => {
    const { userA, userB, pairId } = await setupPair();

    await createTransaction({
      id: "dispute-test-tx",
      pairId,
      amount: 30,
      type: "payment",
      description: "Movie tickets",
      createdBy: userA.uid,
      status: "pending",
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    captureEmailCalls(pageB);
    await loginViaUI(pageB, { email: "bob@tx-test.com", password: "password123" });
    await pageB.goto(`/pair/${pairId}`);

    await pageB.getByRole("button", { name: "Dispute", exact: true }).click();
    await pageB.getByPlaceholder("Reason for dispute\u2026").fill("Wrong amount");
    await pageB.getByRole("button", { name: "Submit Dispute" }).click();

    await expect(
      pageB.getByText("Transaction disputed — creator notified")
    ).toBeVisible({ timeout: 8_000 });

    // Status badge should show "disputed" and the reason should appear
    await expect(pageB.locator(".bg-red-100").first()).toBeVisible({ timeout: 8_000 });
    await expect(pageB.getByText(/Wrong amount/)).toBeVisible({ timeout: 8_000 });

    await ctxB.close();
  });

  test("invalid amount is rejected by the transaction form", async ({ page }) => {
    const { pairId } = await setupPair();
    await loginViaUI(page, { email: "alice@tx-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);

    await page.getByRole("button", { name: "+ Transaction" }).click();
    // Leave amount empty and try to submit
    await page.getByRole("button", { name: "Record Transaction" }).click();

    await expect(page.getByText("Enter a valid amount")).toBeVisible({ timeout: 8_000 });
  });
});
