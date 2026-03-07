import { test, expect } from "../fixtures/test-fixtures";

test.describe("Delete Row Operations", () => {
  test.beforeEach(async ({ navigationHelper, tableHelper, seededProjectId, seededDatasetId }) => {
    await navigationHelper.navigateToDataset(seededProjectId, seededDatasetId);
    await expect(tableHelper.table).toBeVisible();
    await expect(tableHelper.rowCountText).toHaveText("Showing 10 of 10 rows");
  });

  test("should delete a row by name", async ({ chatHelper, tableHelper }) => {
    expect(await tableHelper.hasRecordMatching({ Name: "Widget A" })).toBe(true);

    await chatHelper.sendMessageAndWaitForToolExecution("delete Widget A");

    await expect(tableHelper.rowCountText).toHaveText("Showing 9 of 9 rows");
    expect(await tableHelper.hasRecordMatching({ Name: "Widget A" })).toBe(false);
  });

  test("should delete a row by partial match", async ({
    chatHelper,
    tableHelper,
  }) => {
    expect(await tableHelper.hasRecordMatching({ Name: "Gadget X" })).toBe(true);

    await chatHelper.sendMessageAndWaitForToolExecution("delete Gadget X");

    await expect(tableHelper.rowCountText).toHaveText("Showing 9 of 9 rows");
    expect(await tableHelper.hasRecordMatching({ Name: "Gadget X" })).toBe(false);
  });

  test("should delete a row by product name", async ({ chatHelper, tableHelper }) => {
    expect(await tableHelper.hasRecordMatching({ Name: "Device Lite" })).toBe(true);

    await chatHelper.sendMessageAndWaitForToolExecution("delete Device Lite");

    await expect(tableHelper.rowCountText).toHaveText("Showing 9 of 9 rows");
    expect(await tableHelper.hasRecordMatching({ Name: "Device Lite" })).toBe(false);
  });
});
