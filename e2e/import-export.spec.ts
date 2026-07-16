import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createPair,
  createTransaction,
  createUserProfile,
  loginViaUI,
} from "./helpers";

async function setupPair() {
  const [alice, bob] = await Promise.all([
    createAuthUser("alice@transfer-test.com", "password123"),
    createAuthUser("bob@transfer-test.com", "password123"),
  ]);
  await Promise.all([
    createUserProfile({ uid: alice.uid, email: alice.email, displayName: "Alice" }),
    createUserProfile({ uid: bob.uid, email: bob.email, displayName: "Bob" }),
  ]);
  const pairId = "transfer-test-pair";
  await createPair({
    id: pairId,
    user1Id: alice.uid,
    user1Email: alice.email,
    user1Name: "Alice",
    user2Id: bob.uid,
    user2Email: bob.email,
    user2Name: "Bob",
  });
  return { alice, bob, pairId };
}

test.describe("CSV import and exports", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("maps legacy balance wording, flags invalid data, and skips a duplicate row", async ({ page }) => {
    const { pairId } = await setupPair();
    await loginViaUI(page, { email: "alice@transfer-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);
    await page.getByRole("button", { name: "Import CSV" }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "history.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Total,Memo,Transaction date,Type\n12.50,Dinner,2026-06-01,I paid\n8.50,Cab,2026-06-02,I requested\n12.50,Dinner,2026-06-01,I paid\nnot-a-number,Broken,2026-06-01,I paid\n"
      ),
    });

    await page.getByRole("button", { name: "Preview →" }).click();
    await expect(page.getByText("2 ready")).toBeVisible();
    await expect(page.getByText("1 duplicate skipped")).toBeVisible();
    await expect(page.getByText("1 need attention")).toBeVisible();
    await expect(page.getByText("Partner owes you").first()).toBeVisible();
    await expect(page.getByText("You owe partner")).toBeVisible();
    await page.getByLabel(/Skip the 1 invalid row/).check();
    await page.getByRole("button", { name: "Continue →" }).click();
    await page.getByRole("button", { name: "Import 2 transactions" }).click();

    await expect(page.getByText("Import complete")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Dinner")).toBeVisible();
  });

  test("downloads portable CSV and JSON exports", async ({ page }) => {
    const { alice, pairId } = await setupPair();
    await createTransaction({
      id: "export-transaction",
      pairId,
      amount: 19,
      type: "payment",
      description: "Export dinner",
      createdBy: alice.uid,
      status: "approved",
    });
    await loginViaUI(page, { email: "alice@transfer-test.com", password: "password123" });
    await page.goto(`/pair/${pairId}`);

    await page.getByRole("button", { name: "More options" }).click();
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export transactions" }).click();
    expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/);

    await page.getByRole("button", { name: "More options" }).click();
    const jsonDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export complete data \(JSON\)/ }).click();
    expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);
  });
});
