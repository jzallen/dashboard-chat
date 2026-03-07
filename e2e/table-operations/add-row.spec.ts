import { test, expect } from "../fixtures/test-fixtures";

test.describe("Add Row Operations", () => {
  test.beforeEach(async ({ navigationHelper, tableHelper, seededProjectId, seededDatasetId }) => {
    await navigationHelper.navigateToDataset(seededProjectId, seededDatasetId);
    await expect(tableHelper.table).toBeVisible();
    await expect(tableHelper.rowCountText).toHaveText("Showing 10 of 10 rows");
  });

  test("should add a new product row", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      'add a new row with name "Test Product", category "Electronics", amount 99.99, quantity 25, and inStock true'
    );

    await expect(tableHelper.rowCountText).toHaveText("Showing 10 of 11 rows");

    await tableHelper.goToNextPage();
    expect(await tableHelper.hasRecordMatching({
      Name: "Test Product",
      Category: "Electronics",
      Amount: "$99.99",
      Quantity: "25",
      "In Stock": "✓",
    })).toBe(true);
  });

  test("should add a row with partial data", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      'add new item called "Partial Item" in Hardware category'
    );

    await expect(tableHelper.rowCountText).toHaveText("Showing 10 of 11 rows");

    await tableHelper.goToNextPage();
    expect(await tableHelper.hasRecordMatching({
      Name: "Partial Item",
      Category: "Hardware",
    })).toBe(true);
  });

  test("should add multiple rows in sequence", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      'add a product named "Item One" in category Accessories'
    );

    await chatHelper.sendMessageAndWaitForToolExecution(
      'add another product named "Item Two" in category Components'
    );

    await expect(tableHelper.rowCountText).toHaveText("Showing 10 of 12 rows");

    await tableHelper.goToNextPage();
    expect(await tableHelper.hasRecordMatching({
      Name: "Item One",
      Category: "Accessories",
    })).toBe(true);
    expect(await tableHelper.hasRecordMatching({
      Name: "Item Two",
      Category: "Components",
    })).toBe(true);
  });
});
