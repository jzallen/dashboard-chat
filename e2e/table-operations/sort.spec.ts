import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { test, expect } from "../fixtures/test-fixtures";
import { TableHelper } from "../helpers/table.helper";

test.describe("Sort Operations", () => {
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
