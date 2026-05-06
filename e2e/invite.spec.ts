import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createUserProfile,
  createPair,
  createInvite,
  captureEmailCalls,
  registerViaUI,
  loginViaUI,
} from "./helpers";

test.describe("Invite flow", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("User A can send an invite and it appears as a pending connection", async ({
    page,
  }) => {
    await registerViaUI(page, {
      name: "Alice",
      email: "alice@invite-test.com",
      password: "password123",
    });

    // Mock EmailJS so the invite email doesn't actually send
    const { calls } = captureEmailCalls(page);

    await page.getByRole("button", { name: "+ Transaction" }).first().click();
    await page.getByRole("button", { name: "+ Connect with someone new" }).click();
    await page.getByPlaceholder("Their email address").fill("bob@invite-test.com");
    await page.getByPlaceholder("0.00").fill("25");
    await page.getByRole("button", { name: "Send Invite & Record Transaction" }).click();

    // Wait for the success toast (guarantees sendInviteEmail was called)
    await expect(page.getByText("Invite sent!")).toBeVisible({ timeout: 8_000 });

    // EmailJS should have been called with the invite template
    expect(calls).toHaveLength(1);
    expect(calls[0].templateId).toBe("template_invite");
  });

  test("User B can accept an invite and the pair becomes active for both users", async ({
    page,
    browser,
  }) => {
    // ── Set up: create both users and a pending pair + invite via the API ──
    const [userA, userB] = await Promise.all([
      createAuthUser("alice@accept-test.com", "password123"),
      createAuthUser("bob@accept-test.com", "password123"),
    ]);
    await Promise.all([
      createUserProfile({ uid: userA.uid, email: userA.email, displayName: "Alice" }),
      createUserProfile({ uid: userB.uid, email: userB.email, displayName: "Bob" }),
    ]);

    const pairId = "invite-test-pair";
    await createPair({
      id: pairId,
      user1Id: userA.uid,
      user1Email: "alice@accept-test.com",
      user1Name: "Alice",
      user2Email: "bob@accept-test.com",
      status: "pending",
    });
    await createInvite({
      id: "invite-test-invite",
      fromUid: userA.uid,
      fromEmail: "alice@accept-test.com",
      fromName: "Alice",
      toEmail: "bob@accept-test.com",
      pairId,
    });

    // ── User B logs in and accepts the invite ──
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginViaUI(pageB, { email: "bob@accept-test.com", password: "password123" });

    // Pending invite card should be visible
    await expect(pageB.getByText("Alice", { exact: true })).toBeVisible({ timeout: 8_000 });
    await pageB.getByRole("button", { name: "Accept" }).click();

    // After acceptance the pair should appear under Active Balances
    await expect(pageB.getByText("Active Balances")).toBeVisible({ timeout: 8_000 });
    await expect(pageB.getByText("alice@accept-test.com")).toBeVisible();

    // ── User A's session should also show the pair as active ──
    await loginViaUI(page, { email: "alice@accept-test.com", password: "password123" });
    await expect(page.getByText("Active Balances")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("bob@accept-test.com").first()).toBeVisible();

    await ctxB.close();
  });

  test("User B can accept an invite that includes a pending transaction", async ({
    browser,
  }) => {
    // ── Set up: UserA, UserB, pending pair, invite WITH pendingTransaction ──
    const [userA, userB] = await Promise.all([
      createAuthUser("alice@tx-invite.com", "password123"),
      createAuthUser("bob@tx-invite.com", "password123"),
    ]);
    await Promise.all([
      createUserProfile({ uid: userA.uid, email: userA.email, displayName: "Alice" }),
      createUserProfile({ uid: userB.uid, email: userB.email, displayName: "Bob" }),
    ]);

    const pairId = "tx-invite-pair";
    await createPair({
      id: pairId,
      user1Id: userA.uid,
      user1Email: "alice@tx-invite.com",
      user1Name: "Alice",
      user2Email: "bob@tx-invite.com",
      status: "pending",
    });
    await createInvite({
      id: "tx-invite-invite",
      fromUid: userA.uid,
      fromEmail: "alice@tx-invite.com",
      fromName: "Alice",
      toEmail: "bob@tx-invite.com",
      pairId,
      pendingTransaction: {
        amount: 42,
        type: "payment",
        description: "Dinner",
        date: "2026-05-04",
      },
    });

    // ── User B logs in, accepts, and no permission errors are thrown ──
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    const permissionErrors: string[] = [];
    pageB.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("permission-denied")) {
        permissionErrors.push(msg.text());
      }
    });

    await loginViaUI(pageB, { email: "bob@tx-invite.com", password: "password123" });

    await expect(pageB.getByText("Alice", { exact: true })).toBeVisible({ timeout: 8_000 });
    await pageB.getByRole("button", { name: "Accept" }).click();

    // Pair should become active — no permission-denied errors
    await expect(pageB.getByText("Active Balances")).toBeVisible({ timeout: 8_000 });
    expect(permissionErrors).toHaveLength(0);

    // Navigate to the pair detail page and verify the transaction was created
    await pageB.getByText("alice@tx-invite.com").click();
    await expect(pageB.getByText("Dinner")).toBeVisible({ timeout: 8_000 });

    await ctxB.close();
  });

  test("Pending transaction created on invite acceptance is attributed to the inviter", async ({
    browser,
  }) => {
    const [userA, userB] = await Promise.all([
      createAuthUser("alice@attr-test.com", "password123"),
      createAuthUser("bob@attr-test.com", "password123"),
    ]);
    await Promise.all([
      createUserProfile({ uid: userA.uid, email: userA.email, displayName: "Alice" }),
      createUserProfile({ uid: userB.uid, email: userB.email, displayName: "Bob" }),
    ]);

    const pairId = "attr-test-pair";
    await createPair({
      id: pairId,
      user1Id: userA.uid,
      user1Email: "alice@attr-test.com",
      user1Name: "Alice",
      user2Email: "bob@attr-test.com",
      status: "pending",
    });
    await createInvite({
      id: "attr-test-invite",
      fromUid: userA.uid,
      fromEmail: "alice@attr-test.com",
      fromName: "Alice",
      toEmail: "bob@attr-test.com",
      pairId,
      pendingTransaction: {
        amount: 100,
        type: "payment",
        description: "Groceries",
        date: "2026-05-04",
      },
    });

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginViaUI(pageB, { email: "bob@attr-test.com", password: "password123" });

    await expect(pageB.getByText("Alice", { exact: true })).toBeVisible({ timeout: 8_000 });
    await pageB.getByRole("button", { name: "Accept" }).click();
    await expect(pageB.getByText("Active Balances")).toBeVisible({ timeout: 8_000 });

    // Navigate to pair page — the transaction should appear as pending (awaiting Bob's approval)
    await pageB.getByText("alice@attr-test.com").click();
    await expect(pageB.getByText("Groceries")).toBeVisible({ timeout: 8_000 });

    // Bob (the invitee) should be able to approve the transaction that Alice (inviter) created
    await pageB.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(pageB.getByText("Transaction approved")).toBeVisible({ timeout: 8_000 });

    await ctxB.close();
  });

  test("sending an invite to yourself shows an error", async ({ page }) => {
    await registerViaUI(page, {
      name: "Solo User",
      email: "solo@invite-test.com",
      password: "password123",
    });

    await page.getByRole("button", { name: "+ Transaction" }).first().click();
    await page.getByRole("button", { name: "+ Connect with someone new" }).click();
    await page.getByPlaceholder("Their email address").fill("solo@invite-test.com");
    await page.getByPlaceholder("0.00").fill("25");
    await page.getByRole("button", { name: "Send Invite & Record Transaction" }).click();

    await expect(page.locator("[role='status']")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("You can't invite yourself")).toBeVisible();
  });
});
