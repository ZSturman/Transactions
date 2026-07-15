import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createInvite,
  createPair,
  createUserProfile,
  loginViaUI,
} from "./helpers";

async function setupInvite(
  expiresAt?: Date,
  recipientHasAccount = true
) {
  const alice = await createAuthUser("alice@link-test.com", "password123");
  const recipientEmail = "bob@link-test.com";
  const bob = recipientHasAccount
    ? await createAuthUser(recipientEmail, "password123")
    : null;
  await createUserProfile({ uid: alice.uid, email: alice.email, displayName: "Alice" });
  if (bob) {
    await createUserProfile({ uid: bob.uid, email: bob.email, displayName: "Bob" });
  }
  const pairId = "link-test-pair";
  const inviteId = "secure-invite-link";
  await createPair({
    id: pairId,
    user1Id: alice.uid,
    user1Email: alice.email,
    user1Name: "Alice",
    user2Email: recipientEmail,
    status: "pending",
  });
  await createInvite({
    id: inviteId,
    fromUid: alice.uid,
    fromEmail: alice.email,
    fromName: "Alice",
    toEmail: recipientEmail,
    pairId,
    expiresAt,
  });
  return { pairId, inviteId };
}

test.describe("Invitation links", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("accepts a valid link only after the invited user signs in", async ({ page }) => {
    const { pairId, inviteId } = await setupInvite(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await page.goto(`/invite/${inviteId}`);
    await expect(page).toHaveURL(/\/login\?continue=.*&email=bob%40link-test\.com/);
    await expect(page.locator('[autocomplete="email"]')).toHaveValue("bob@link-test.com");
    await page.locator('[autocomplete="email"]').fill("bob@link-test.com");
    await page.locator('[autocomplete="current-password"]').fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`/invite/${inviteId}`);
    await expect(page.getByText("Alice invited you")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(`/pair/${pairId}`);
  });

  test("takes a new recipient to sign up with their invitation email prefilled", async ({ page }) => {
    const { pairId, inviteId } = await setupInvite(
      new Date(Date.now() + 24 * 60 * 60 * 1000),
      false
    );
    const permissionErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && msg.text().includes("permission-denied")) {
        permissionErrors.push(msg.text());
      }
    });

    await page.goto(`/invite/${inviteId}`);
    await expect(page).toHaveURL(/\/register\?continue=.*&email=bob%40link-test\.com/);
    await expect(page.locator('[autocomplete="email"]')).toHaveValue("bob@link-test.com");

    await page.locator('[autocomplete="name"]').fill("Bob");
    await page.locator('[autocomplete="new-password"]').fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(`/invite/${inviteId}`);
    await expect(page.getByText("Alice invited you")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page).toHaveURL(`/pair/${pairId}`);
    expect(permissionErrors).toHaveLength(0);
  });

  test("does not allow an expired link to be accepted", async ({ page }) => {
    const { inviteId } = await setupInvite(new Date(Date.now() - 60_000));
    await loginViaUI(page, { email: "bob@link-test.com", password: "password123" });
    await page.goto(`/invite/${inviteId}`);
    await expect(page.getByText("This invitation is no longer valid")).toBeVisible({ timeout: 8_000 });
  });
});
