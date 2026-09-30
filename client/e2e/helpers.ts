import { expect, type Page } from "@playwright/test";

// Demo accounts from server/prisma/seed.ts.
export const PASSWORD = "Password@123";
export const ACCOUNTS = {
  customer: "customer@bookit.local",
  provider: "provider@bookit.local",
  admin: "admin@bookit.local",
} as const;

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Something unique per test run, for names that must not clash. */
export const runId = () => Date.now().toString(36);
