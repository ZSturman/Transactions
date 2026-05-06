import { test, expect } from "@playwright/test";
import {
  clearAllEmulatorData,
  createAuthUser,
  createUserProfile,
  registerViaUI,
  loginViaUI,
} from "./helpers";

test.describe("Authentication", () => {
  test.beforeEach(async () => {
    await clearAllEmulatorData();
  });

  test("register creates account and redirects to dashboard", async ({ page }) => {
    await registerViaUI(page, {
      name: "Alice Test",
      email: "alice@test.com",
      password: "password123",
    });

    await expect(page).toHaveURL("/");
    await expect(page.getByText("Hi, Alice")).toBeVisible();
  });

  test("login with valid credentials redirects to dashboard", async ({ page }) => {
    // Create user via Auth emulator API (faster than going through the UI)
    const { uid } = await createAuthUser("login-user@test.com", "password123");
    await createUserProfile({ uid, email: "login-user@test.com", displayName: "Login User" });

    await loginViaUI(page, { email: "login-user@test.com", password: "password123" });

    await expect(page).toHaveURL("/");
    await expect(page.getByText("Hi, Login")).toBeVisible();
  });

  test("wrong password shows an error", async ({ page }) => {
    await createAuthUser("wrong-pass@test.com", "correctpass");

    await page.goto("/login");
    await page.locator('[autocomplete="email"]').fill("wrong-pass@test.com");
    await page.locator('[autocomplete="current-password"]').fill("wrongpass");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Should stay on /login and show an error toast
    await expect(page).toHaveURL("/login");
    await expect(page.locator("[role='status']")).toBeVisible({ timeout: 8_000 });
  });

  test("unauthenticated navigation to / redirects to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("/login");
    await expect(page).toHaveURL("/login");
  });

  test("authenticated user visiting /login is redirected to dashboard", async ({ page }) => {
    await registerViaUI(page, {
      name: "Redirect User",
      email: "redirect@test.com",
      password: "password123",
    });

    // Already logged in — navigating to /login should bounce back to /
    await page.goto("/login");
    await page.waitForURL("/");
    await expect(page).toHaveURL("/");
  });
});
