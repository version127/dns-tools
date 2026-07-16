import { expect, test } from "playwright/test";

test("the root is the DNS Tools hub", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "DNS tools" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "DNS Tools home" })).toBeVisible();
  await expect(page.getByRole("banner").getByAltText("Version127")).toBeVisible();
  await expect(page.getByRole("banner").getByText("Built by Version127")).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://127.0.0.1:1274");
  await expect(page.locator('nav[aria-label="DNS tools"] a')).toHaveCount(7);
  for (const name of [
    "DNS Lookup",
    "DNS Trace Explorer",
    "DNS Change Checker",
    "Nameserver Delegation Checker",
    "DNSSEC Chain Checker",
    "SOA Consistency Checker",
    "CAA Policy Checker",
  ]) {
    await expect(page.locator(".dns-tool-card").getByText(name, { exact: true })).toBeVisible();
  }
});
