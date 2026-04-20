import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 30000,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3001",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-tablet",
      // iPad viewport size, but keep chromium as the engine — we care about
      // the layout at that width, not about Safari-specific behavior.
      use: {
        ...devices["iPad Pro 11"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
      },
      // Only the cross-viewport smoke spec runs on tablet/mobile — existing
      // per-flow specs stay desktop-only so CI time stays bounded (#557).
      testMatch: /responsive\.spec\.ts/,
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "cd ../backend && npm run start:dev",
      port: 3000,
      timeout: 120000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: process.env.CI ? "npm start -- -p 3001" : "npm run dev",
      url: "http://localhost:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      env: {
        NEXT_PUBLIC_MOCK_AUTH: "true",
      },
    },
  ],
});
