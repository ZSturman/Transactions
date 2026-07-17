import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createBalanceSnapshot,
  createPair,
  createUserProfile,
  loginViaUI,
} from "./helpers";

test.describe("Balance history on mobile", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("uses clean trend lines without a marker for every transaction", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    const [alice, bob] = await Promise.all([
      createAuthUser("alice@balance-chart.test", "password123"),
      createAuthUser("bob@balance-chart.test", "password123"),
    ]);
    await Promise.all([
      createUserProfile({ uid: alice.uid, email: alice.email, displayName: "Alice" }),
      createUserProfile({ uid: bob.uid, email: bob.email, displayName: "Bob" }),
    ]);

    const pairId = "balance-chart-pair";
    await createPair({
      id: pairId,
      user1Id: alice.uid,
      user1Email: alice.email,
      user1Name: "Alice",
      user2Id: bob.uid,
      user2Email: bob.email,
      user2Name: "Bob",
      balance: -35,
    });
    await createBalanceSnapshot({
      id: "first-change",
      pairId,
      balance: -15,
      triggeredBy: alice.uid,
      reason: "transaction approved",
    });
    await createBalanceSnapshot({
      id: "second-change",
      pairId,
      balance: -40,
      triggeredBy: alice.uid,
      reason: "transaction approved",
    });
    await createBalanceSnapshot({
      id: "third-change",
      pairId,
      balance: -35,
      triggeredBy: alice.uid,
      reason: "counter-proposal accepted",
    });

    await loginViaUI(page, { email: alice.email, password: "password123" });
    await page.goto(`/pair/${pairId}`);

    const chart = page.getByTestId("balance-history-chart");
    await expect(chart).toBeVisible();
    await expect(chart.locator('[data-testid^="balance-history-point-"]')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    await page.goto("/");
    const netChart = page.getByTestId("net-balance-chart");
    await expect(netChart).toBeVisible();
    await expect(netChart.locator('[data-testid^="net-balance-point-"]')).toHaveCount(0);
  });
});
