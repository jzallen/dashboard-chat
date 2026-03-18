import { Page } from "@playwright/test";

export class NavigationHelper {
  constructor(private page: Page) {}

  async navigateToDataset(projectId: string, datasetId: string) {
    await this.page.goto(`/projects/${projectId}/datasets/${datasetId}`);
    await this.page.waitForSelector('[data-testid="data-table"]', {
      timeout: 30000,
    });
  }

  async navigateToProject(projectId: string) {
    await this.page.goto(`/projects/${projectId}`);
    await this.page.waitForLoadState("networkidle");
  }

  async navigateToOrg() {
    await this.page.goto("/");
    await this.page.waitForLoadState("networkidle");
  }
}
