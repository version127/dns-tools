import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.DNS_TOOLS_BASE_URL ?? "http://127.0.0.1:1273";
const name = process.env.DNS_TOOLS_TEST_NAME ?? "cloudflare.com";
const outDir = path.resolve(process.env.DNS_TOOLS_SCREENSHOT_DIR ?? "screenshots");
const tools = [
  ["dns-lookup", "/dns-lookup", "lookup", "Look up DNS"],
  ["dns-trace", "/dns-trace", "trace", "Trace DNS"],
  ["dns-change-checker", "/dns-change-checker", "change-checker", "Check DNS change"],
  ["nameserver-checker", "/nameserver-checker", "nameserver-checker", "Check nameservers"],
  ["dnssec-checker", "/dnssec-checker", "dnssec-checker", "Validate DNSSEC"],
  ["soa-checker", "/soa-checker", "soa-checker", "Compare SOA records"],
  ["caa-checker", "/caa-checker", "caa-checker", "Check CAA policy"],
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(outDir, "dns-tools-hub.png") });

for (const [fileName, route, endpoint, buttonName] of tools) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  await page.locator("form input").first().fill(name);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/dns/${endpoint}`) && response.request().method() === "POST", { timeout: 65_000 });
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`${fileName} returned ${response.status()}`);
  const result = page.locator('section[aria-live="polite"]').first();
  await result.waitFor({ state: "visible", timeout: 10_000 });
  await result.evaluate((element) => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 76, behavior: "instant" }));
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error(`${fileName} has horizontal page overflow.`);
  await page.screenshot({ animations: "disabled", path: path.join(outDir, `${fileName}.png`) });
  console.log(`${fileName}\t${response.status()}`);
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
await page.screenshot({ animations: "disabled", fullPage: true, path: path.join(outDir, "dns-tools-mobile.png") });

await browser.close();
if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
console.log(`Saved ${tools.length + 2} screenshots to ${outDir}`);
