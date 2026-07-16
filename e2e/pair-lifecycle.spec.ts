import { expect, test } from "@playwright/test";
import {
  captureEmailCalls,
  clearAllEmulatorData,
  createAuthUser,
  createPair,
  createTransaction,
  createUserProfile,
  getFirestoreDocument,
  listFirestoreDocuments,
  loginViaUI,
  registerViaUI,
  trackFirebaseFailures,
} from "./helpers";

const alice = { email: "alice@pair-lifecycle.test", password: "password123" };
const bob = { email: "bob@pair-lifecycle.test", password: "password123" };

async function setupPair(balance = 0) {
  const [userA, userB] = await Promise.all([
    createAuthUser(alice.email, alice.password),
    createAuthUser(bob.email, bob.password),
  ]);
  await Promise.all([
    createUserProfile({ uid: userA.uid, email: userA.email, displayName: "Alice" }),
    createUserProfile({ uid: userB.uid, email: userB.email, displayName: "Bob" }),
  ]);

  const pairId = "pair-lifecycle";
  await createPair({
    id: pairId,
    user1Id: userA.uid,
    user1Email: userA.email,
    user1Name: "Alice",
    user2Id: userB.uid,
    user2Email: userB.email,
    user2Name: "Bob",
    balance,
    status: "active",
  });

  return { pairId, userA, userB };
}

function expectNoFirebaseFailures(...failures: ReturnType<typeof trackFirebaseFailures>[]) {
  for (const failure of failures) {
    expect(failure.permissionErrors).toHaveLength(0);
    expect(failure.authLookupFailures).toHaveLength(0);
  }
}

async function pairData(pairId: string) {
  const pair = await getFirestoreDocument(`pairs/${pairId}`);
  if (!pair) throw new Error(`Pair ${pairId} was not found`);
  return pair;
}

test.describe("Pair lifecycle and Firebase permissions", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("settles an active balance, writes a settlement and balance snapshot", async ({ page }) => {
    const { pairId, userA } = await setupPair(75);
    const failures = trackFirebaseFailures(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "Settle Balance" }).click();
    await expect(page.getByRole("heading", { name: "Settle Up" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm Settle" }).click();
    await expect(page.getByText("Balance settled!")).toBeVisible({ timeout: 8_000 });

    await expect.poll(async () => (await pairData(pairId)).balance).toBe(0);
    const transactions = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 75,
            type: "settlement",
            status: "approved",
            createdBy: userA.uid,
          }),
        }),
      ])
    );
    const snapshots = await listFirestoreDocuments(`pairs/${pairId}/balanceSnapshots`);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ data: expect.objectContaining({ balance: 0, reason: "settled" }) }),
      ])
    );
    expectNoFirebaseFailures(failures);
  });

  test("records the opposite payment direction and the partner can approve it", async ({ page, browser }) => {
    const { pairId } = await setupPair();
    const senderFailures = trackFirebaseFailures(page);
    captureEmailCalls(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "+ Transaction" }).click();
    await page.getByRole("button", { name: "↓ Bob paid me" }).click();
    await page.getByPlaceholder("0.00").fill("25");
    await page.getByPlaceholder("e.g. Dinner, Rent, Groceries").fill("Refund");
    await page.getByRole("button", { name: "Record Transaction" }).click();
    await expect(page.getByText("Transaction recorded — waiting for approval")).toBeVisible({ timeout: 8_000 });

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    const recipientFailures = trackFirebaseFailures(recipientPage);
    try {
      captureEmailCalls(recipientPage);
      await loginViaUI(recipientPage, bob);
      await recipientPage.goto(`/pair/${pairId}`);
      await recipientPage.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(recipientPage.getByText("Transaction approved — balance updated!")).toBeVisible({
        timeout: 8_000,
      });

      await expect.poll(async () => (await pairData(pairId)).balance).toBe(-25);
      const [transaction] = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
      expect(transaction.data).toMatchObject({ amount: 25, type: "request", status: "approved" });
      const snapshots = await listFirestoreDocuments(`pairs/${pairId}/balanceSnapshots`);
      expect(snapshots.some((snapshot) => snapshot.data.balance === -25)).toBe(true);
      expectNoFirebaseFailures(senderFailures, recipientFailures);
    } finally {
      await recipientContext.close();
    }
  });

  test("accepts a counter-proposal and uses the proposed amount for the balance", async ({ page, browser }) => {
    const { pairId, userA } = await setupPair();
    await createTransaction({
      id: "counter-accept",
      pairId,
      amount: 80,
      type: "payment",
      description: "Shared dinner",
      createdBy: userA.uid,
    });

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    const recipientFailures = trackFirebaseFailures(recipientPage);
    try {
      captureEmailCalls(recipientPage);
      await loginViaUI(recipientPage, bob);
      await recipientPage.goto(`/pair/${pairId}`);
      await recipientPage.getByRole("button", { name: "Dispute", exact: true }).click();
      await recipientPage.getByPlaceholder("Reason for dispute…").fill("Only half was shared");
      await recipientPage.locator('input[type="number"]').fill("40");
      await recipientPage.getByRole("button", { name: "Submit Dispute" }).click();
      await expect(recipientPage.getByText("Transaction disputed — creator notified")).toBeVisible({
        timeout: 8_000,
      });

      const creatorFailures = trackFirebaseFailures(page);
      await loginViaUI(page, alice);
      await page.goto(`/pair/${pairId}`);
      await page.getByRole("button", { name: "Accept $40.00" }).click();
      await expect(page.getByText("Counter-proposal accepted!")).toBeVisible({ timeout: 8_000 });

      await expect.poll(async () => (await pairData(pairId)).balance).toBe(40);
      const transaction = await getFirestoreDocument(`pairs/${pairId}/transactions/counter-accept`);
      expect(transaction).toMatchObject({ amount: 40, status: "approved", proposedAmount: 40 });
      const snapshots = await listFirestoreDocuments(`pairs/${pairId}/balanceSnapshots`);
      expect(snapshots.some((snapshot) => snapshot.data.reason === "counter-proposal accepted")).toBe(true);
      expectNoFirebaseFailures(recipientFailures, creatorFailures);
    } finally {
      await recipientContext.close();
    }
  });

  test("rejects a counter-proposal without changing the balance", async ({ page, browser }) => {
    const { pairId, userA } = await setupPair();
    await createTransaction({
      id: "counter-reject",
      pairId,
      amount: 90,
      type: "payment",
      description: "Hotel",
      createdBy: userA.uid,
    });

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    try {
      captureEmailCalls(recipientPage);
      const recipientFailures = trackFirebaseFailures(recipientPage);
      await loginViaUI(recipientPage, bob);
      await recipientPage.goto(`/pair/${pairId}`);
      await recipientPage.getByRole("button", { name: "Dispute", exact: true }).click();
      await recipientPage.getByPlaceholder("Reason for dispute…").fill("Wrong split");
      await recipientPage.locator('input[type="number"]').fill("45");
      await recipientPage.getByRole("button", { name: "Submit Dispute" }).click();
      await expect(recipientPage.getByText("Transaction disputed — creator notified")).toBeVisible({
        timeout: 8_000,
      });

      const creatorFailures = trackFirebaseFailures(page);
      await loginViaUI(page, alice);
      await page.goto(`/pair/${pairId}`);
      await page.getByRole("button", { name: "Reject", exact: true }).click();
      await expect(page.getByText("Counter-proposal rejected")).toBeVisible({ timeout: 8_000 });
      await expect.poll(async () => (await pairData(pairId)).balance).toBe(0);
      await expect.poll(async () => {
        const transaction = await getFirestoreDocument(`pairs/${pairId}/transactions/counter-reject`);
        return transaction?.proposedAmount;
      }).toBeNull();
      const transaction = await getFirestoreDocument(`pairs/${pairId}/transactions/counter-reject`);
      expect(transaction).toMatchObject({ amount: 90, status: "disputed", proposedAmount: null });
      expectNoFirebaseFailures(recipientFailures, creatorFailures);
    } finally {
      await recipientContext.close();
    }
  });

  test("cancels an owned pending transaction and archives then restores an approved transaction", async ({ page }) => {
    const { pairId, userA } = await setupPair();
    await Promise.all([
      createTransaction({
        id: "approved-to-archive",
        pairId,
        amount: 20,
        type: "payment",
        description: "Approved history",
        createdBy: userA.uid,
        status: "approved",
      }),
      createTransaction({
        id: "pending-to-cancel",
        pairId,
        amount: 15,
        type: "request",
        description: "Pending request",
        createdBy: userA.uid,
      }),
    ]);
    const failures = trackFirebaseFailures(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByText("Request cancelled")).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => getFirestoreDocument(`pairs/${pairId}/transactions/pending-to-cancel`)).toBeNull();

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Transaction archived")).toBeVisible({ timeout: 8_000 });
    await page.getByLabel("Show archived").check();
    await expect(page.getByText("Approved history")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Unarchive", exact: true }).click();
    await expect(page.getByText("Transaction restored")).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await getFirestoreDocument(`pairs/${pairId}/transactions/approved-to-archive`))?.archived).toBe(false);
    expectNoFirebaseFailures(failures);
  });

  test("forgives part of a debt and persists the reduced balance", async ({ page }) => {
    const { pairId, userA } = await setupPair(100);
    const failures = trackFirebaseFailures(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Forgive debt…" }).click();
    await page.locator('input[type="number"]').fill("40");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Confirm Forgiveness" })).toBeVisible();
    await page.getByRole("button", { name: "Confirm Forgiveness" }).click();
    await expect(page.getByText("Debt forgiven!")).toBeVisible({ timeout: 8_000 });

    await expect.poll(async () => (await pairData(pairId)).balance).toBe(60);
    const transactions = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 40,
            type: "forgiveness",
            status: "approved",
            createdBy: userA.uid,
          }),
        }),
      ])
    );
    expectNoFirebaseFailures(failures);
  });

  test("archives all resolved history, hides the balance, and restores it from the dashboard", async ({ page }) => {
    const { pairId, userA } = await setupPair();
    await Promise.all([
      createTransaction({
        id: "archive-all-payment",
        pairId,
        amount: 12,
        type: "payment",
        description: "Resolved payment",
        createdBy: userA.uid,
        status: "approved",
      }),
      createTransaction({
        id: "archive-all-request",
        pairId,
        amount: 8,
        type: "request",
        description: "Resolved request",
        createdBy: userA.uid,
        status: "approved",
      }),
    ]);
    const failures = trackFirebaseFailures(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Archive resolved transactions" }).click();
    await expect(page.getByText("Archived 2 transactions")).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await pairData(pairId)).hidden).toBe(true);
    const archivedTransactions = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
    expect(archivedTransactions.every((transaction) => transaction.data.archived === true)).toBe(true);

    await page.goto("/");
    await expect(page.getByText("All your balances are resolved.")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Show 1 archived balance" }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByText("Balance restored to dashboard")).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await pairData(pairId)).hidden).toBe(false);
    expectNoFirebaseFailures(failures);
  });

  test("keeps a shared pair usable after one account is deleted and labels it clearly", async ({ page, browser }) => {
    const { pairId, userB } = await setupPair(30);
    const ownerFailures = trackFirebaseFailures(page);
    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);

    const partnerContext = await browser.newContext();
    const partnerPage = await partnerContext.newPage();
    const partnerFailures = trackFirebaseFailures(partnerPage);
    try {
      await loginViaUI(partnerPage, bob);
      await partnerPage.goto("/settings");
      await partnerPage.getByRole("button", { name: "Danger Zone" }).click();
      await partnerPage.getByPlaceholder("Your display name").fill("Bob");
      await partnerPage.getByRole("button", { name: "Permanently Delete Account" }).click();
      await partnerPage.waitForURL("/login");

      await expect.poll(async () => {
        const pair = await pairData(pairId);
        return Boolean((pair.deletedUsers as Record<string, unknown> | undefined)?.[userB.uid]);
      }).toBe(true);

      await page.goto(`/pair/${pairId}`);
      await expect(page.getByText("[Deleted Account]", { exact: true })).toBeVisible({ timeout: 8_000 });
      await page.getByRole("button", { name: "Settle Balance" }).click();
      await page.getByRole("button", { name: "Confirm Settle" }).click();
      await expect(page.getByText("Balance settled!")).toBeVisible({ timeout: 8_000 });
      await expect.poll(async () => (await pairData(pairId)).balance).toBe(0);
      expectNoFirebaseFailures(ownerFailures, partnerFailures);
    } finally {
      await partnerContext.close();
    }
  });

  test("handles an unknown recipient cancellation without orphaning pair or invite data", async ({ page }) => {
    const failures = trackFirebaseFailures(page);
    captureEmailCalls(page);
    await registerViaUI(page, {
      name: "Alice",
      email: "alice@no-recipient.test",
      password: "password123",
    });

    // A newly registered account renders matching dashboard controls in the
    // header and empty-state card. Both launch the same modal.
    const dashboardTransactionButtons = page.getByRole("button", { name: "+ Transaction" });
    await expect(dashboardTransactionButtons).toHaveCount(2);
    await dashboardTransactionButtons.first().click();
    await page.getByRole("button", { name: "+ Connect with someone new" }).click();
    await page.getByPlaceholder("Their email address").fill("not-created@pair-lifecycle.test");
    await page.getByPlaceholder("0.00").fill("18");
    await page.getByRole("button", { name: "Send Invite & Record Transaction" }).click();
    await expect(page.getByText("Invite saved!")).toBeVisible({ timeout: 8_000 });
    expect(await listFirestoreDocuments("pairs")).toHaveLength(1);
    expect(await listFirestoreDocuments("invites")).toHaveLength(1);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Invite cancelled")).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => listFirestoreDocuments("pairs")).toHaveLength(0);
    await expect.poll(() => listFirestoreDocuments("invites")).toHaveLength(0);
    expectNoFirebaseFailures(failures);
  });

  test("does not expose a pair to an authenticated non-member", async ({ browser }) => {
    const { pairId } = await setupPair(25);
    const outsider = await createAuthUser("mallory@pair-lifecycle.test", "password123");
    await createUserProfile({ uid: outsider.uid, email: outsider.email, displayName: "Mallory" });

    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    const failures = trackFirebaseFailures(outsiderPage);
    try {
      await loginViaUI(outsiderPage, { email: outsider.email, password: "password123" });
      await outsiderPage.goto(`/pair/${pairId}`);
      await expect(outsiderPage.getByText("Balance not found")).toBeVisible({ timeout: 8_000 });
      await expect(outsiderPage.getByText("Alice", { exact: true })).not.toBeVisible();
      await outsiderPage.waitForTimeout(300);
      expectNoFirebaseFailures(failures);
    } finally {
      await outsiderContext.close();
    }
  });
});
