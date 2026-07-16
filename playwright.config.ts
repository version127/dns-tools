import { defineConfig, devices } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/*.spec.ts"],
  timeout: 45_000,
  workers: 1,
  expect: { timeout: 7_000 },
  use: {
    baseURL: "http://127.0.0.1:1274",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run test:server",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:1274/api/health",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ],
});
