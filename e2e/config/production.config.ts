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
    baseURL: "https://dashboard-chat.pages.dev",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "production",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
