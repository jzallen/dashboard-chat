import * as fs from "fs";
import * as path from "path";

import { test, expect } from "../fixtures/test-fixtures";
import { TableHelper } from "../helpers/table.helper";

test.describe("Filter Operations", () => {
  let initialRecords: Record<string, string>[];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "dev-token-static");
      localStorage.setItem("auth_refresh_token", "dev-refresh-token-001");
      localStorage.setItem("auth_token_expires_at", String(Date.now() + 300000));
      localStorage.setItem("last_activity_ts", String(Date.now()));
      localStorage.setItem("auth_user", JSON.stringify({id:"dev-user-001",email:"dev@localhost",org_id:"dev-org-001",name:"Dev User"}));
    });
    const seedData = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../.seed-data.json"), "utf-8"));
    await page.goto(`/projects/${seedData.projectId}/datasets/${seedData.datasetId}`);
    await page.waitForSelector('[data-testid="data-table"]', { timeout: 30000 });
    const tableHelper = await TableHelper.create(page);
    initialRecords = await tableHelper.getPageRecords();
    await page.close();
  });

  test.beforeEach(async ({ navigationHelper, seededProjectId, seededDatasetId }) => {
    await navigationHelper.navigateToDataset(seededProjectId, seededDatasetId);
  });

  test("should filter products by quantity greater than 50", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "show products where quantity is greater than 50"
    );

    const expectedRecords = initialRecords.filter(
      (r) => parseInt(r["Quantity"]) > 50
    );
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should filter products by amount less than 100", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "filter by amount less than 100"
    );

    const expectedRecords = initialRecords.filter((r) => {
      const amount = parseFloat(r["Amount"].replace(/[$,]/g, ""));
      return amount < 100;
    });
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should filter products by category equals Electronics", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "show only Electronics category"
    );

    const expectedRecords = initialRecords.filter(
      (r) => r["Category"] === "Electronics"
    );
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should filter products by name containing Widget", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "find items with Widget in the name"
    );

    const expectedRecords = initialRecords.filter((r) =>
      r["Name"].toLowerCase().includes("widget")
    );
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should apply multiple filters in a single prompt", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "show Electronics with quantity greater than 50"
    );

    const expectedRecords = initialRecords.filter(
      (r) => r["Category"] === "Electronics" && parseInt(r["Quantity"]) > 50
    );
    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(expectedRecords);
  });

  test("should clear filters when requested", async ({
    chatHelper,
    tableHelper,
  }) => {
    await chatHelper.sendMessageAndWaitForToolExecution(
      "filter quantity greater than 100"
    );

    const filteredRecords = await tableHelper.getPageRecords();
    expect(filteredRecords.length).toBeLessThan(initialRecords.length);

    await chatHelper.sendMessageAndWaitForToolExecution("clear all filters");

    const records = await tableHelper.getPageRecords();
    expect(records).toEqual(initialRecords);
  });
});
