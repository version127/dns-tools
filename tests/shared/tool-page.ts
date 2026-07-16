import { expect, test } from "playwright/test";

export function testToolPage(route: string, title: string) {
  test(`${title} is a complete server-rendered tool page`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, follow");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("input").first()).toBeVisible();
    await expect(page.locator("form button").first()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `http://127.0.0.1:1274${route}`,
    );
    await expect(page.locator('nav[aria-label="DNS tools"] a')).toHaveCount(7);
  });
}
