import { test, expect } from "../fixtures/test-fixtures";
import { TableHelper } from "../helpers/table.helper";

test.describe("Delete Row Operations", () => {
  let initialRecords: Record<string, string>[];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");

    const tableHelper = await TableHelper.create(page);
    initialRecords = await tableHelper.tableToRecords();

    await page.close();
  });

  test.beforeEach(async ({ tableHelper }) => {
    await tableHelper.table.page().goto("/");
    await expect(tableHelper.table).toBeVisible();
  });

  test("should delete the first row", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("delete the first row");

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecords.length - 1);
    expect(await tableHelper.hasRecordMatching(initialRecords[0])).toBe(false);
    expect(await tableHelper.recordAtIndex(initialRecords[1], 0)).toBe(true);
  });

  test("should delete row at specific index", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("delete row at index 2");

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecords.length - 1);
    expect(await tableHelper.hasRecordMatching(initialRecords[2])).toBe(false);
    expect(await tableHelper.recordAtIndex(initialRecords[3], 2)).toBe(true);
  });

  test("should delete the last row", async ({ chatHelper, tableHelper }) => {
    const lastIndex = initialRecords.length - 1;

    await chatHelper.sendMessageAndWaitForToolExecution(
      `delete row at index ${lastIndex}`
    );

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecords.length - 1);
    expect(await tableHelper.hasRecordMatching(initialRecords[lastIndex])).toBe(false);
    expect(await tableHelper.recordAtIndex(initialRecords[lastIndex - 1], lastIndex - 1)).toBe(true);
  });
});
