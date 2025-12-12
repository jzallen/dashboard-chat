import { test as base } from "@playwright/test";
import { ChatHelper } from "../helpers/chat.helper";
import { TableHelper } from "../helpers/table.helper";
import { WaitHelper } from "../helpers/wait.helper";

type Fixtures = {
  chatHelper: ChatHelper;
  tableHelper: TableHelper;
  waitHelper: WaitHelper;
};

export const test = base.extend<Fixtures>({
  chatHelper: async ({ page }, use) => {
    await use(new ChatHelper(page));
  },
  tableHelper: async ({ page }, use) => {
    await use(new TableHelper(page));
  },
  waitHelper: async ({ page }, use) => {
    await use(new WaitHelper(page));
  },
});

export { expect } from "@playwright/test";
