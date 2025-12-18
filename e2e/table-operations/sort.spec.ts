import { test, expect } from "../fixtures/test-fixtures";
import { TableHelper } from "../helpers/table.helper";

test.describe("Sort Operations", () => {
  let initialRecords: Record<string, string>[];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/");

    const tableHelper = await TableHelper.create(page);
    initialRecords = await tableHelper.getPageRecords();

    await page.close();
  });

  test.beforeEach(async ({ tableHelper }) => {
    await tableHelper.table.page().goto("/");
    await expect(tableHelper.table).toBeVisible();
  });

  test("should sort by amount descending", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "sort by amount descending"
    );

    const expectedRecords = [...initialRecords].sort((a, b) => {
      const aAmount = parseFloat(a["Amount"].replace(/[$,]/g, ""));
      const bAmount = parseFloat(b["Amount"].replace(/[$,]/g, ""));
      return bAmount - aAmount;
    });
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should sort by amount ascending", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "sort by amount from lowest to highest"
    );

    const expectedRecords = [...initialRecords].sort((a, b) => {
      const aAmount = parseFloat(a["Amount"].replace(/[$,]/g, ""));
      const bAmount = parseFloat(b["Amount"].replace(/[$,]/g, ""));
      return aAmount - bAmount;
    });
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should sort by quantity descending", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "sort by quantity in descending order"
    );

    const expectedRecords = [...initialRecords].sort((a, b) => {
      return parseInt(b["Quantity"]) - parseInt(a["Quantity"]);
    });
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should sort by name alphabetically", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "sort alphabetically by name"
    );

    const expectedRecords = [...initialRecords].sort((a, b) =>
      a["Name"].localeCompare(b["Name"])
    );
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should clear sorting when requested", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution("sort by amount desc");

    const sortedRecords = await tableHelper.getPageRecords();
    expect(sortedRecords).not.toEqual(initialRecords);

    await chatHelper.sendMessageAndWaitForToolExecution("remove sorting");

    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(initialRecords);
  });

  test("should apply multi-column sort in a single prompt", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "sort by category ascending then by amount descending"
    );

    const expectedRecords = [...initialRecords].sort((a, b) => {
      const categoryCompare = a["Category"].localeCompare(b["Category"]);
      if (categoryCompare !== 0) return categoryCompare;
      const aAmount = parseFloat(a["Amount"].replace(/[$,]/g, ""));
      const bAmount = parseFloat(b["Amount"].replace(/[$,]/g, ""));
      return bAmount - aAmount;
    });
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });
});
