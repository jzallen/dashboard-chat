import { test, expect } from "../fixtures/test-fixtures";
import { TableHelper } from "../helpers/table.helper";

test.describe("Add Row Operations", () => {
  let initialRecordCount: number;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");

    const tableHelper = await TableHelper.create(page);
    const records = await tableHelper.tableToRecords();
    initialRecordCount = records.length;

    await page.close();
  });

  test.beforeEach(async ({ tableHelper }) => {
    await tableHelper.table.page().goto("/");
    await expect(tableHelper.table).toBeVisible();
  });

  test("should add a new product row", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      'add a new row with name "Test Product", category "Electronics", amount 99.99, quantity 25, and inStock true'
    );

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecordCount + 1);
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

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecordCount + 1);
    expect(await tableHelper.hasRecordMatching({
      Name: "Partial Item",
      Category: "Hardware",
      Amount: "$0.00",
      Quantity: "0",
      "In Stock": "✓",
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

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecordCount + 2);
    expect(await tableHelper.hasRecordMatching({
      Name: "Item One",
      Category: "Accessories",
      Amount: "$0.00",
      Quantity: "0",
      "In Stock": "✓",
    })).toBe(true);
    expect(await tableHelper.hasRecordMatching({
      Name: "Item Two",
      Category: "Components",
      Amount: "$0.00",
      Quantity: "0",
      "In Stock": "✓",
    })).toBe(true);
  });
});
