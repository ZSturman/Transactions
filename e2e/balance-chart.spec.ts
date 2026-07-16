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

  test("selecting a history point shows that date's balance and change", async ({ page }) => {
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
    await expect(page.getByTestId("balance-history-details")).toContainText(
      "Tap or click a point"
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    const selectedPoint = page.getByTestId("balance-history-point-2");
    await expect(selectedPoint).toHaveCount(1);
    await selectedPoint.click();

    const details = page.getByTestId("balance-history-details");
    await expect(details).toContainText("Balance: $35.00 (you owe)");
    await expect(details).toContainText("Change: +$5.00");
    await expect(details).toContainText("Counter proposal accepted");

    await page.goto("/");
    const netChart = page.getByTestId("net-balance-chart");
    await expect(netChart).toBeVisible();
    const netSelectedPoint = page.getByTestId("net-balance-point-2");
    await expect(netSelectedPoint).toHaveCount(1);
    await netSelectedPoint.click();

    const netDetails = page.getByTestId("net-balance-details");
    await expect(netDetails).toContainText("Net balance: $35.00 (you owe)");
    await expect(netDetails).toContainText("Change: +$5.00");
  });
});
