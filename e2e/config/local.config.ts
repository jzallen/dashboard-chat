import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  globalSetup: require.resolve("../global-setup.ts"),
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
  // When running via Bazel (BAZEL_TEST=1), services are already running via docker-compose.
  // Skip webServer startup in that case.
  ...(process.env.BAZEL_TEST
    ? {}
    : {
        webServer: [
          {
            command: "npm --prefix frontend run dev",
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
          {
            command:
              "cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000",
            url: "http://localhost:8000/health",
            reuseExistingServer: !process.env.CI,
            timeout: 120000,
          },
        ],
      }),
});
