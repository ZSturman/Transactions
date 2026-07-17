import { expect, test, type Locator } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createBalanceSnapshot,
  createPair,
  createTransaction,
  createUserProfile,
  loginViaUI,
} from "./helpers";

const approvalDate = new Date("2026-07-16T18:00:00Z");

async function hoverAndClickLastPoint(chart: Locator) {
  const surface = chart.locator(".recharts-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("Chart surface was not rendered");

  // Recharts selects the nearest x-axis datum. Moving near the right edge
  // chooses the final historical point without needing visible point markers.
  const position = { x: Math.max(1, box.width - 12), y: box.height / 2 };
  await surface.hover({ position });
  await surface.click({ position });
}

test.describe("Historical balance charts", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("uses transaction event dates, supports hover and tap details, and respects archived history", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    const [alice, bob] = await Promise.all([
      createAuthUser("alice@chart-history.test", "password123"),
      createAuthUser("bob@chart-history.test", "password123"),
    ]);
    await Promise.all([
      createUserProfile({ uid: alice.uid, email: alice.email, displayName: "Alice" }),
      createUserProfile({ uid: bob.uid, email: bob.email, displayName: "Bob" }),
    ]);

    const pairId = "historical-chart-pair";
    await createPair({
      id: pairId,
      user1Id: alice.uid,
      user1Email: alice.email,
      user1Name: "Alice",
      user2Id: bob.uid,
      user2Email: bob.email,
      user2Name: "Bob",
      balance: -80,
    });
    await Promise.all([
      createTransaction({
        id: "november-request",
        pairId,
        amount: 100,
        type: "request",
        description: "November expense",
        createdBy: alice.uid,
        status: "approved",
        date: new Date("2023-11-03T12:00:00"),
        createdAt: approvalDate,
      }),
      createTransaction({
        id: "archived-december-request",
        pairId,
        amount: 30,
        type: "request",
        description: "Archived December expense",
        createdBy: alice.uid,
        status: "approved",
        archived: true,
        date: new Date("2023-12-01T12:00:00"),
        createdAt: approvalDate,
      }),
      createTransaction({
        id: "january-payment",
        pairId,
        amount: 25,
        type: "payment",
        description: "January payment",
        createdBy: alice.uid,
        status: "approved",
        date: new Date("2024-01-16T12:00:00"),
        createdAt: approvalDate,
      }),
      createTransaction({
        id: "february-payment",
        pairId,
        amount: 25,
        type: "payment",
        description: "February payment",
        createdBy: alice.uid,
        status: "approved",
        date: new Date("2024-02-12T12:00:00"),
        createdAt: approvalDate,
      }),
      // These deliberately use the approval date. The chart must ignore them
      // in favour of the transaction event dates above.
      createBalanceSnapshot({
        id: "july-approval-snapshot-one",
        pairId,
        balance: -100,
        triggeredBy: bob.uid,
        timestamp: approvalDate,
      }),
      createBalanceSnapshot({
        id: "july-approval-snapshot-two",
        pairId,
        balance: -80,
        triggeredBy: bob.uid,
        timestamp: approvalDate,
      }),
    ]);

    await loginViaUI(page, { email: alice.email, password: "password123" });
    await page.goto(`/pair/${pairId}`);

    const chart = page.getByTestId("balance-history-chart");
    await expect(chart).toBeVisible();
    await expect(chart.getByText("Nov 3, 23")).toBeVisible();
    await expect(chart.getByText("Jan 16, 24")).toBeVisible();
    await expect(chart.getByText("Feb 12, 24")).toBeVisible();
    await expect(chart.getByText("Dec 1, 23")).toHaveCount(0);
    await expect(chart.locator(".recharts-dot")).toHaveCount(0);
    await expect(page.getByTestId("balance-history-details")).toContainText("Hover, click, or tap");

    await hoverAndClickLastPoint(chart);
    await expect(page.getByTestId("balance-history-tooltip")).toContainText("February 12, 2024");
    await expect(page.getByTestId("balance-history-tooltip")).toContainText("Balance: $50.00 (you owe)");
    await expect(page.getByTestId("balance-history-details")).toContainText("February 12, 2024");
    await expect(page.getByTestId("balance-history-details")).toContainText("Change: +$25.00");

    await page.getByLabel("Show archived").check();
    await expect(chart.getByText("Dec 1, 23")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });

  test("builds the dashboard net chart from multiple pairs' event dates", async ({ page }) => {
    const [alice, bob, charlie] = await Promise.all([
      createAuthUser("alice@net-chart.test", "password123"),
      createAuthUser("bob@net-chart.test", "password123"),
      createAuthUser("charlie@net-chart.test", "password123"),
    ]);
    await Promise.all([
      createUserProfile({ uid: alice.uid, email: alice.email, displayName: "Alice" }),
      createUserProfile({ uid: bob.uid, email: bob.email, displayName: "Bob" }),
      createUserProfile({ uid: charlie.uid, email: charlie.email, displayName: "Charlie" }),
    ]);

    await Promise.all([
      createPair({
        id: "net-pair-one",
        user1Id: alice.uid,
        user1Email: alice.email,
        user1Name: "Alice",
        user2Id: bob.uid,
        user2Email: bob.email,
        user2Name: "Bob",
        balance: -70,
      }),
      createPair({
        id: "net-pair-two",
        user1Id: alice.uid,
        user1Email: alice.email,
        user1Name: "Alice",
        user2Id: charlie.uid,
        user2Email: charlie.email,
        user2Name: "Charlie",
        balance: 20,
      }),
      createTransaction({
        id: "net-november-request",
        pairId: "net-pair-one",
        amount: 100,
        type: "request",
        createdBy: alice.uid,
        status: "approved",
        date: new Date("2023-11-03T12:00:00"),
        createdAt: approvalDate,
      }),
      createTransaction({
        id: "net-december-payment",
        pairId: "net-pair-two",
        amount: 20,
        type: "payment",
        createdBy: alice.uid,
        status: "approved",
        date: new Date("2023-12-01T12:00:00"),
        createdAt: approvalDate,
      }),
      createTransaction({
        id: "net-january-payment",
        pairId: "net-pair-one",
        amount: 30,
        type: "payment",
        createdBy: alice.uid,
        status: "approved",
        date: new Date("2024-01-16T12:00:00"),
        createdAt: approvalDate,
      }),
    ]);

    await loginViaUI(page, { email: alice.email, password: "password123" });
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();

    const chart = page.getByTestId("net-balance-chart");
    await expect(chart).toBeVisible();
    await expect(chart.getByText("Nov 3, 23")).toBeVisible();
    await expect(chart.getByText("Dec 1, 23")).toBeVisible();
    await expect(chart.getByText("Jan 16, 24")).toBeVisible();
    await expect(chart.locator(".recharts-dot")).toHaveCount(0);

    await hoverAndClickLastPoint(chart);
    await expect(page.getByTestId("net-balance-tooltip")).toContainText("January 16, 2024");
    await expect(page.getByTestId("net-balance-tooltip")).toContainText("Net balance: $50.00 (you owe)");
    await expect(page.getByTestId("net-balance-details")).toContainText("Change: +$30.00");
  });
});
