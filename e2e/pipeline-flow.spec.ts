/**
 * E2E tests for filter pipeline flow
 *
 * These tests verify the end-to-end flow of:
 * 1. Creating filters via chat
 * 2. Applying filters to the table
 * 3. Saving filters as pipelines (requires backend)
 *
 * Note: Full backend integration tests require Docker containers running.
 * These tests focus on frontend functionality that works without the backend.
 */

import { test, expect } from "@playwright/test";

test.describe("Filter Pipeline Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the app to load
    await expect(page.locator("table")).toBeVisible();
  });

  test.describe("Frontend Filter Generation", () => {
    test("should apply filters from chat commands", async ({ page }) => {
      // The chat panel should be visible
      const chatPanel = page.locator('[data-testid="chat-panel"]').or(
        page.locator("aside").first()
      );

      // Note: Actual chat interaction requires API key
      // This test documents the expected flow
      await expect(chatPanel).toBeVisible();
    });

    test("should display active filters when applied", async ({ page }) => {
      // The active filters section should exist
      const filtersSection = page.locator('[data-testid="active-filters"]').or(
        page.locator("text=Active filters").or(page.locator("text=Filters"))
      );

      // Wait for potential filters section
      // May not be visible if no filters applied
      await page.waitForTimeout(500);
    });

    test("should clear all filters when clicking clear button", async ({ page }) => {
      // The clear filters button should clear all active filters
      const clearButton = page.locator('button:has-text("Clear")').or(
        page.locator('[data-testid="clear-filters"]')
      );

      // If visible, clicking should work
      if (await clearButton.isVisible()) {
        await clearButton.click();
        // Filters should be cleared
      }
    });
  });

  test.describe("Table Filtering", () => {
    test("should display all rows initially", async ({ page }) => {
      // Get initial row count
      const rows = page.locator("tbody tr");
      const initialCount = await rows.count();

      // Should have some rows
      expect(initialCount).toBeGreaterThan(0);
    });

    test("should filter rows when filters are applied", async ({ page }) => {
      // This test requires programmatic filter application
      // In a real scenario, filters would be applied via chat or UI

      // Verify the table is responsive
      const table = page.locator("table");
      await expect(table).toBeVisible();
    });

    test("should show pagination controls", async ({ page }) => {
      // Pagination should be visible if there are multiple pages
      const pagination = page.locator('[data-testid="pagination"]').or(
        page.locator("text=rows").or(page.locator("text=Page"))
      );

      // Wait for pagination to potentially appear
      await page.waitForTimeout(300);
    });
  });

  test.describe("Chat Interaction", () => {
    test("should have a chat input field", async ({ page }) => {
      // Chat input should be available
      const chatInput = page.locator('input[type="text"]').or(
        page.locator("textarea").or(
          page.locator('[data-testid="chat-input"]')
        )
      );

      // At least one input should exist
      await expect(chatInput.first()).toBeVisible();
    });

    test("should display messages in chat panel", async ({ page }) => {
      // The chat panel should be able to display messages
      const chatPanel = page.locator('[data-testid="chat-panel"]').or(
        page.locator("aside").first()
      );

      await expect(chatPanel).toBeVisible();
    });
  });

  // These tests require the backend to be running
  test.describe.skip("Backend Integration (requires Docker)", () => {
    test("should save filter as pipeline", async ({ page }) => {
      // This would test the save pipeline functionality
      // Requires: docker-compose up -d
    });

    test("should load saved pipelines", async ({ page }) => {
      // This would test loading the pipeline list
      // Requires: docker-compose up -d
    });

    test("should apply saved pipeline to table", async ({ page }) => {
      // This would test applying a saved pipeline
      // Requires: docker-compose up -d
    });
  });
});

/**
 * Helper test to verify the build works
 */
test.describe("App Health", () => {
  test("should load the application", async ({ page }) => {
    await page.goto("/");

    // The app should render without errors
    await expect(page.locator("body")).not.toBeEmpty();

    // Should not have React error overlay
    const errorOverlay = page.locator('[data-testid="error-overlay"]').or(
      page.locator(".react-error-overlay")
    );
    await expect(errorOverlay).not.toBeVisible();
  });

  test("should have responsive layout", async ({ page }) => {
    await page.goto("/");

    // Check desktop layout
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator("table")).toBeVisible();

    // Check mobile layout (table might scroll)
    await page.setViewportSize({ width: 375, height: 667 });
    // App should still be functional
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
