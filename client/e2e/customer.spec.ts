import { expect, test } from "@playwright/test";
import { ACCOUNTS, login, runId } from "./helpers";

test("sign up shows the verify-your-email step", async ({ page }) => {
  const email = `e2e-${runId()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Password@123");
  await page.getByRole("button", { name: /create account|sign up|register/i }).click();
  await expect(page.getByText(email)).toBeVisible();
});

test("customer searches, books a time and cancels it", async ({ page }) => {
  await login(page, ACCOUNTS.customer);

  // Search.
  await page.goto("/customer/venues");
  await page.getByLabel("Search").fill("turf");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const firstVenue = page.locator('a[href^="/customer/venues/"]').first();
  await expect(firstVenue).toBeVisible();
  const venueName = (await firstVenue.locator("h3, h2").first().textContent())?.trim() ?? "";
  await firstVenue.click();
  await expect(page.getByRole("heading", { name: venueName })).toBeVisible();

  // Pick a day about a week out (seeded bookings thin out after a week), then the first free time.
  const picker = page.locator("section", { has: page.getByRole("heading", { name: "Book a time" }) });
  await picker.getByRole("button", { pressed: false }).nth(8).click();
  const startTimes = picker.locator("p:text('Start time') + div button");
  await expect(startTimes.first()).toBeVisible();
  const time = (await startTimes.first().textContent())?.trim();
  await startTimes.first().click();

  await expect(picker.getByText("Total")).toBeVisible();
  await picker.getByRole("button", { name: /Request booking/ }).click();
  await expect(picker.getByText(/Requested .* The venue will confirm it soon/)).toBeVisible();

  // It's on My Bookings; cancel it.
  await page.goto("/customer/bookings");
  const card = page.locator("article, li, div").filter({ hasText: venueName }).filter({ hasText: time ?? "" }).filter({ has: page.getByRole("button", { name: "Cancel booking" }) }).last();
  await expect(card).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await card.getByRole("button", { name: "Cancel booking" }).click();
  await expect(card.getByText("Cancelled", { exact: true })).toBeVisible();
});
