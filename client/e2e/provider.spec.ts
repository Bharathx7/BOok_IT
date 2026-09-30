import { expect, test } from "@playwright/test";
import { ACCOUNTS, login, logout, runId } from "./helpers";

test("provider lists a venue, opens it for bookings and an admin approves it", async ({ page }) => {
  const name = `E2E Arena ${runId()}`;

  // Provider: create the venue.
  await login(page, ACCOUNTS.provider);
  await page.goto("/provider/venues");
  await page.getByRole("link", { name: "+ Add venue" }).click();
  await page.getByLabel("Venue name").fill(name);
  await page.getByLabel("Main sport").selectOption("Badminton");
  await page.getByLabel("Price per hour (₹)").fill("600");
  await page.getByLabel("City").fill("Chennai");
  await page.getByRole("button", { name: "Create venue" }).click();
  await expect(page.getByText("Awaiting approval.")).toBeVisible();

  // Opening hours: a template for every day, then slots for the next week.
  await page.getByRole("link", { name: /schedule/i }).first().click();
  await page.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("Template added.")).toBeVisible();
  await page.getByLabel("How far ahead").selectOption("7");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Create \d+ slots?$/ }).click();
  await expect(page.getByText(/Created \d+ slots?/)).toBeVisible();
  await logout(page);

  // Admin: approve it from the queue.
  await login(page, ACCOUNTS.admin);
  await page.goto("/admin/venues");
  const row = page.locator("li").filter({ hasText: name });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`${name} is approved and live.`)).toBeVisible();
  await logout(page);

  // Customers can now find it.
  await login(page, ACCOUNTS.customer);
  await page.goto(`/customer/venues?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(name)).toBeVisible();
});
