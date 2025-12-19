import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: "html",
  timeout: 60000,
  expect: {
    timeout: 30000,
  },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "local",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: "npm run dev:worker",
      url: "http://localhost:8787/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
