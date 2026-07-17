import { expect, test } from "@playwright/test";
import {
  captureEmailCalls,
  clearAllEmulatorData,
  createAuthUser,
  createBalanceSnapshot,
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

async function setupPair(balance = 0, hidden = false) {
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
    hidden,
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

  test("requires the partner to approve a settlement request before zeroing the balance", async ({ page, browser }) => {
    const { pairId, userA } = await setupPair(75);
    await createBalanceSnapshot({
      id: "starting-balance",
      pairId,
      balance: 75,
      triggeredBy: userA.uid,
    });
    const failures = trackFirebaseFailures(page);
    captureEmailCalls(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "Settle Balance" }).click();
    await expect(page.getByRole("heading", { name: "Settle Up" })).toBeVisible();
    await page.getByRole("button", { name: "Request Settlement" }).click();
    await expect(page.getByText("Settlement request sent — waiting for approval")).toBeVisible({ timeout: 8_000 });

    await expect.poll(async () => (await pairData(pairId)).balance).toBe(75);
    const pendingTransactions = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
    expect(pendingTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 75,
            type: "settlement",
            status: "pending",
            createdBy: userA.uid,
            balanceAtRequest: 75,
          }),
        }),
      ])
    );

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    const recipientFailures = trackFirebaseFailures(recipientPage);
    try {
      captureEmailCalls(recipientPage);
      await loginViaUI(recipientPage, bob);
      await recipientPage.goto("/");
      await expect(recipientPage.getByText("1 Transaction Needs Your Attention")).toBeVisible({ timeout: 8_000 });
      await recipientPage.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(recipientPage.getByText("Settlement approved — balance updated!")).toBeVisible({ timeout: 8_000 });

      await expect.poll(async () => (await pairData(pairId)).balance).toBe(0);
      await recipientPage.goto(`/pair/${pairId}`);
      await expect(recipientPage.getByTestId("balance-history-chart")).toBeVisible({ timeout: 8_000 });
      expectNoFirebaseFailures(failures, recipientFailures);
    } finally {
      await recipientContext.close();
    }

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
    const settlement = transactions.find((transaction) => transaction.data.type === "settlement");
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            balance: 0,
            reason: "settlement approved",
            transactionId: settlement?.id,
            effectiveAt: expect.any(String),
          }),
        }),
      ])
    );
  });

  test("shows pending dashboard actions for a legacy hidden connection", async ({ page }) => {
    const { pairId, userA } = await setupPair(0, true);
    await createTransaction({
      id: "legacy-hidden-pending",
      pairId,
      amount: 30,
      type: "payment",
      description: "New request after archiving history",
      createdBy: userA.uid,
      status: "pending",
    });
    const failures = trackFirebaseFailures(page);
    captureEmailCalls(page);

    await loginViaUI(page, bob);
    await page.goto("/");
    await expect(page.getByText("1 Transaction Needs Your Attention")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("New request after archiving history")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Transaction approved — balance updated!")).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await pairData(pairId)).balance).toBe(30);
    expectNoFirebaseFailures(failures);
  });

  test("leaves the balance unchanged when a settlement request is denied", async ({ page, browser }) => {
    const { pairId } = await setupPair(60);
    const requesterFailures = trackFirebaseFailures(page);
    captureEmailCalls(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "Settle Balance" }).click();
    await page.getByRole("button", { name: "Request Settlement" }).click();
    await expect(page.getByText("Settlement request sent — waiting for approval")).toBeVisible({ timeout: 8_000 });

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    const recipientFailures = trackFirebaseFailures(recipientPage);
    try {
      captureEmailCalls(recipientPage);
      await loginViaUI(recipientPage, bob);
      await recipientPage.goto("/");
      await recipientPage.getByRole("button", { name: "Deny", exact: true }).click();
      await expect(recipientPage.getByText("Settlement request denied")).toBeVisible({ timeout: 8_000 });
      await expect.poll(async () => (await pairData(pairId)).balance).toBe(60);
      const [settlement] = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
      expect(settlement.data).toMatchObject({ type: "settlement", status: "disputed" });
      expectNoFirebaseFailures(requesterFailures, recipientFailures);
    } finally {
      await recipientContext.close();
    }
  });

  test("requires a new settlement request when the balance changes before approval", async ({ page, browser }) => {
    const { pairId } = await setupPair(75);
    captureEmailCalls(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "Settle Balance" }).click();
    await page.getByRole("button", { name: "Request Settlement" }).click();
    await expect(page.getByText("Settlement request sent — waiting for approval")).toBeVisible({ timeout: 8_000 });

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    try {
      captureEmailCalls(recipientPage);
      await loginViaUI(recipientPage, bob);
      await recipientPage.goto(`/pair/${pairId}`);
      await recipientPage.getByRole("button", { name: "+ Transaction" }).click();
      await recipientPage.getByPlaceholder("0.00").fill("10");
      await recipientPage.getByRole("button", { name: "Record Transaction" }).click();
      await expect(recipientPage.getByText("Transaction recorded — waiting for approval")).toBeVisible({ timeout: 8_000 });

      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(page.getByText("Transaction approved — balance updated!")).toBeVisible({ timeout: 8_000 });
      await expect.poll(async () => (await pairData(pairId)).balance).toBe(65);

      await recipientPage.goto("/");
      await recipientPage.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(recipientPage.getByText("The balance changed after this settlement was requested. Send a new request.")).toBeVisible({ timeout: 8_000 });
      await expect.poll(async () => (await pairData(pairId)).balance).toBe(65);
      const settlement = (await listFirestoreDocuments(`pairs/${pairId}/transactions`)).find(
        (transaction) => transaction.data.type === "settlement"
      );
      expect(settlement?.data.status).toBe("pending");
    } finally {
      await recipientContext.close();
    }
  });

  test("records the opposite payment direction and the partner can approve it", async ({ page, browser }) => {
    const { pairId } = await setupPair();
    const senderFailures = trackFirebaseFailures(page);
    captureEmailCalls(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "+ Transaction" }).click();
    await page.getByRole("button", { name: "You owe Bob" }).click();
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

  test("archives resolved history without hiding the active connection", async ({ page }) => {
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
    const archivedTransactions = await listFirestoreDocuments(`pairs/${pairId}/transactions`);
    expect(archivedTransactions.every((transaction) => transaction.data.archived === true)).toBe(true);

    await page.goto("/");
    await expect(page.getByText("Bob", { exact: true })).toBeVisible({ timeout: 8_000 });
    expectNoFirebaseFailures(failures);
  });

  test("removes a settled connection for both users while retaining read-only history", async ({ page, browser }) => {
    const { pairId, userA } = await setupPair();
    await createTransaction({
      id: "removed-history",
      pairId,
      amount: 20,
      type: "payment",
      description: "Retained history",
      createdBy: userA.uid,
      status: "approved",
    });
    const failures = trackFirebaseFailures(page);

    await loginViaUI(page, alice);
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "More options" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Remove connection…" }).click();
    await expect(page.getByRole("status")).toHaveText("Connection removed", { timeout: 8_000 });
    await expect.poll(async () => (await pairData(pairId)).status).toBe("removed");

    await page.goto(`/pair/${pairId}`);
    await expect(page.getByRole("main").getByText("Connection removed", { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Retained history")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Transaction" })).not.toBeVisible();

    const partnerContext = await browser.newContext();
    const partnerPage = await partnerContext.newPage();
    const partnerFailures = trackFirebaseFailures(partnerPage);
    try {
      await loginViaUI(partnerPage, bob);
      await partnerPage.goto("/");
      await expect(partnerPage.getByText("No transactions yet")).toBeVisible({ timeout: 8_000 });
    } finally {
      await partnerContext.close();
    }

    await page.goto("/");
    await page.getByRole("button", { name: "+ Transaction" }).first().click();
    await page.getByRole("button", { name: "+ Connect with someone new" }).click();
    await page.getByPlaceholder("Their email address").fill(bob.email);
    await page.getByPlaceholder("0.00").fill("15");
    await page.getByRole("button", { name: "Send Invite & Record Transaction" }).click();
    await expect(page.getByText("Invite saved!")).toBeVisible({ timeout: 8_000 });
    expectNoFirebaseFailures(failures, partnerFailures);
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
      await expect(page.getByRole("button", { name: "Settle Balance" })).toBeVisible();
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
