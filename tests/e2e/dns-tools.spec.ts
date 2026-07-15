import { expect, test } from "playwright/test";

const tools = [
  ["/dns-lookup", "DNS lookup"],
  ["/dns-trace", "DNS Trace Explorer"],
  ["/dns-change-checker", "DNS Change Checker"],
  ["/nameserver-checker", "Nameserver Delegation Checker"],
  ["/dnssec-checker", "DNSSEC Chain Checker"],
  ["/soa-checker", "SOA Consistency Checker"],
  ["/caa-checker", "CAA Policy Checker"],
] as const;

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
  for (const name of ["DNS Lookup", "DNS Trace Explorer", "DNS Change Checker", "Nameserver Delegation Checker", "DNSSEC Chain Checker", "SOA Consistency Checker", "CAA Policy Checker"]) {
    await expect(page.locator(".dns-tool-card").getByText(name, { exact: true })).toBeVisible();
  }
});

test("legacy nested URLs redirect to the flat routes", async ({ page }) => {
  await page.goto("/dns-tools");
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/dns-tools/dns-lookup");
  await expect(page).toHaveURL(/\/dns-lookup$/);
});

for (const [route, title] of tools) {
  test(`${title} is a complete server-rendered tool page`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, follow");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.locator("input").first()).toBeVisible();
    await expect(page.locator("form button").first()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `http://127.0.0.1:1274${route}`);
    await expect(page.locator('nav[aria-label="DNS tools"] a')).toHaveCount(7);
  });
}

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
