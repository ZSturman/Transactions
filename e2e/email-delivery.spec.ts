import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  getCapturedEmails,
  registerViaUI,
} from "./helpers";

function trackFirebaseFailures(page: import("@playwright/test").Page) {
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

test.describe("Server-delivered invitation emails", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("contains a working registration link and accepts without Firebase errors", async ({
    page,
    browser,
  }) => {
    const senderEmail = "alice@delivery-test.com";
    const recipientEmail = "bob@delivery-test.com";
    const senderFailures = trackFirebaseFailures(page);

    await registerViaUI(page, {
      name: "Alice",
      email: senderEmail,
      password: "password123",
    });

    await page.getByRole("button", { name: "+ Transaction" }).first().click();
    await page.getByRole("button", { name: "+ Connect with someone new" }).click();
    await page.getByPlaceholder("Their email address").fill(recipientEmail);
    await page.getByPlaceholder("0.00").fill("25");
    await page.getByRole("button", { name: "Send Invite & Record Transaction" }).click();
    await expect(page.getByText("Invite saved!")).toBeVisible({ timeout: 8_000 });

    await expect.poll(async () => (await getCapturedEmails()).length).toBe(1);
    const [email] = await getCapturedEmails();
    expect(email.to).toEqual([recipientEmail]);
    expect(email.subject).toContain("invited you to Transactions");

    const actionMatch = email.html.match(/href="([^"]+)"/);
    expect(actionMatch).not.toBeNull();
    const invitationUrl = new URL(actionMatch![1]);
    const inviteId = invitationUrl.pathname.split("/")[2];
    expect(invitationUrl.origin).toBe("http://localhost:3000");
    expect(invitationUrl.pathname).toBe(`/invite/${inviteId}`);

    const recipientContext = await browser.newContext();
    const recipientPage = await recipientContext.newPage();
    const recipientFailures = trackFirebaseFailures(recipientPage);
    try {
      await recipientPage.goto(invitationUrl.href);
      await expect(recipientPage).toHaveURL(
        new RegExp(`/register\\?continue=.*&email=${encodeURIComponent(recipientEmail)}`)
      );
      await expect(recipientPage.locator('[autocomplete="email"]')).toHaveValue(recipientEmail);

      await recipientPage.locator('[autocomplete="name"]').fill("Bob");
      await recipientPage.locator('[autocomplete="new-password"]').fill("password123");
      await recipientPage.getByRole("button", { name: "Create account" }).click();
      await expect(recipientPage).toHaveURL(`/invite/${inviteId}`);
      await expect(recipientPage.getByText("Alice invited you")).toBeVisible({ timeout: 8_000 });
      await recipientPage.getByRole("button", { name: "Accept invitation" }).click();
      await expect(recipientPage).toHaveURL(/\/pair\/[^/]+$/);
      await expect(recipientPage.getByRole("heading", { name: "Alice" })).toBeVisible({
        timeout: 8_000,
      });

      expect(senderFailures.permissionErrors).toHaveLength(0);
      expect(senderFailures.authLookupFailures).toHaveLength(0);
      expect(recipientFailures.permissionErrors).toHaveLength(0);
      expect(recipientFailures.authLookupFailures).toHaveLength(0);
    } finally {
      await recipientContext.close();
    }
  });
});
