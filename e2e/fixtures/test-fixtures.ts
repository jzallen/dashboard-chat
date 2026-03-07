import * as fs from "fs";
import * as path from "path";

import { test as authTest } from "./auth.fixture";
import { ChatHelper } from "../helpers/chat.helper";
import { NavigationHelper } from "./navigation.fixture";
import { TableHelper } from "../helpers/table.helper";
import { WaitHelper } from "../helpers/wait.helper";

function loadSeedData(): { projectId: string; datasetId: string } {
  const seedPath = path.resolve(__dirname, "../.seed-data.json");
  return JSON.parse(fs.readFileSync(seedPath, "utf-8"));
}

type Fixtures = {
  chatHelper: ChatHelper;
  tableHelper: TableHelper;
  waitHelper: WaitHelper;
  navigationHelper: NavigationHelper;
  seededProjectId: string;
  seededDatasetId: string;
};

export const test = authTest.extend<Fixtures>({
  chatHelper: async ({ page }, use) => {
    await use(new ChatHelper(page));
  },
  tableHelper: async ({ page }, use) => {
    await use(new TableHelper(page));
  },
  waitHelper: async ({ page }, use) => {
    await use(new WaitHelper(page));
  },
  navigationHelper: async ({ page }, use) => {
    await use(new NavigationHelper(page));
  },
  seededProjectId: async ({}, use) => {
    const { projectId } = loadSeedData();
    await use(projectId);
  },
  seededDatasetId: async ({}, use) => {
    const { datasetId } = loadSeedData();
    await use(datasetId);
  },
});

export { expect } from "@playwright/test";
