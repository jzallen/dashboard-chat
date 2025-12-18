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

  test("should delete a row by name", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("delete Widget A");

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecords.length - 1);
    expect(await tableHelper.hasRecordMatching({ Name: "Widget A" })).toBe(false);
  });

  test("should delete a row by partial match", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("delete Gadget X");

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecords.length - 1);
    expect(await tableHelper.hasRecordMatching({ Name: "Gadget X" })).toBe(false);
  });

  test("should delete a row by product name", async ({ chatHelper, tableHelper }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("delete Device Lite");

    const records = await tableHelper.tableToRecords();
    expect(records.length).toBe(initialRecords.length - 1);
    expect(await tableHelper.hasRecordMatching({ Name: "Device Lite" })).toBe(false);
  });
});
