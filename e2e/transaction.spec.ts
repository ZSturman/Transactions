import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createUserProfile,
  createPair,
  createTransaction,
  captureEmailCalls,
  getFirestoreDocument,
  listFirestoreDocuments,
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

  test("sorts transaction lists and tables by the event date shown to the user", async ({ page }) => {
    const { userA, pairId } = await setupPair();
    await Promise.all([
      createTransaction({
        id: "event-date-old",
        pairId,
        amount: 10,
        type: "payment",
        description: "Older event",
        createdBy: userA.uid,
        date: new Date("2026-01-15T12:00:00Z"),
        createdAt: new Date("2026-07-15T12:00:00Z"),
      }),
      createTransaction({
        id: "event-date-new",
        pairId,
        amount: 20,
        type: "payment",
        description: "Newer event",
        createdBy: userA.uid,
        date: new Date("2026-03-15T12:00:00Z"),
        createdAt: new Date("2026-01-15T12:00:00Z"),
      }),
    ]);

    await loginViaUI(page, { email: "alice@tx-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);

    const listItems = page.locator('[data-testid^="transaction-item-"]');
    await expect(listItems.nth(0)).toContainText("Newer event");
    await expect(listItems.nth(0)).toContainText("Mar 15, 2026");
    await expect(listItems.nth(1)).toContainText("Older event");
    await expect(listItems.nth(1)).toContainText("Jan 15, 2026");

    await page.getByRole("button", { name: "Table" }).click();

    const descriptions = page.locator("tbody tr td:nth-child(3)");
    await expect(descriptions).toHaveText(["Newer event", "Older event"]);

    await page.getByRole("columnheader", { name: /Date/ }).click();
    await expect(descriptions).toHaveText(["Older event", "Newer event"]);
  });

  test("records a custom split using only the amount the partner owes", async ({ page, browser }) => {
    const { userA, pairId } = await setupPair();
    captureEmailCalls(page);
    await loginViaUI(page, { email: "alice@tx-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);

    await page.getByRole("button", { name: "+ Transaction" }).click();
    await page.getByRole("button", { name: "Split an expense" }).click();
    await page.getByLabel("Total shared expense").fill("500");
    await page.getByLabel("Your share percentage").fill("20");
    await expect(page.getByText("Bob owes you $400.00")).toBeVisible();
    await page.getByPlaceholder("e.g. Dinner, Rent, Groceries").fill("Celebration meal");
    await page.getByRole("button", { name: "Record Transaction" }).click();

    await expect(page.getByText("Transaction recorded — waiting for approval")).toBeVisible({ timeout: 8_000 });
    const [created] = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
    expect(created?.data).toMatchObject({
      amount: 400,
      type: "payment",
      createdBy: userA.uid,
      split: {
        totalAmount: 500,
        creatorSharePercent: 20,
        paidBy: "creator",
      },
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    try {
      captureEmailCalls(pageB);
      await loginViaUI(pageB, { email: "bob@tx-test.com", password: "password123" });
      await pageB.goto(`/pair/${pairId}`);
      await expect(pageB.getByText("Split expense · You owe Alice")).toBeVisible();
      await expect(pageB.getByText("We spent $500.00 · you 80% / Alice 20%. Alice paid the bill.")).toBeVisible();
      await pageB.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(pageB.getByText("Transaction approved — balance updated!")).toBeVisible({ timeout: 8_000 });
      await expect.poll(async () => (await getFirestoreDocument(`pairs/${pairId}`))?.balance).toBe(400);
    } finally {
      await ctxB.close();
    }
  });

  test("approves or declines every pending transaction from the dashboard", async ({ page }) => {
    const { userA, pairId } = await setupPair();
    await Promise.all([
      createTransaction({ id: "bulk-approve-one", pairId, amount: 20, type: "payment", createdBy: userA.uid }),
      createTransaction({ id: "bulk-approve-two", pairId, amount: 30, type: "payment", createdBy: userA.uid }),
    ]);
    captureEmailCalls(page);
    await loginViaUI(page, { email: "bob@tx-test.com", password: "password123" });
    await page.goto("/");

    await page.getByRole("button", { name: "Approve all" }).click();
    await expect(page.getByText("Approved all 2 pending transactions")).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await getFirestoreDocument(`pairs/${pairId}`))?.balance).toBe(50);

    await Promise.all([
      createTransaction({ id: "bulk-decline-one", pairId, amount: 15, type: "payment", createdBy: userA.uid }),
      createTransaction({ id: "bulk-decline-two", pairId, amount: 25, type: "request", createdBy: userA.uid }),
    ]);
    await expect(page.getByRole("button", { name: "Decline all" })).toBeVisible({ timeout: 8_000 });
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Decline all" }).click();
    await expect(page.getByText("Declined all 2 pending transactions")).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => {
      const transactions = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
      return transactions
        .filter((transaction) => transaction.id.startsWith("bulk-decline"))
        .every((transaction) => transaction.data.status === "disputed");
    }).toBe(true);
  });
});
