import { expect, test } from "playwright/test";

test("legacy nested URLs redirect to the flat routes", async ({ page }) => {
  await page.goto("/dns-tools");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dns-tools/dns-lookup");
  await expect(page).toHaveURL(/\/dns-lookup$/);
});

test("query-filled tool URLs remain noindex", async ({ page }) => {
  const response = await page.goto("/dns-lookup?name=example.com&selection=A&resolver=cloudflare");
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "http://127.0.0.1:1274/dns-lookup");
});

test("health and invalid API requests have stable contracts", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", service: "dns-tools" });

  for (const endpoint of ["lookup", "trace", "change-checker", "nameserver-checker", "dnssec-checker", "soa-checker", "caa-checker"]) {
    const response = await request.post(`/api/dns/${endpoint}`, { data: {} });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBeTruthy();
  }
});

test("cross-origin browser requests are rejected", async ({ request }) => {
  const response = await request.post("/api/dns/lookup", {
    headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    data: { name: "example.com", selection: "A", resolver: "cloudflare" },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe("cross_origin_request");
});

test("the mobile DNS tools menu opens and closes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.goto("/dns-lookup");
  const toggle = page.getByRole("button", { name: "DNS tools" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(toggle).toBeFocused();
});
