import { Page } from "@playwright/test";

export class WaitHelper {
  constructor(private page: Page) {}

  async waitForStreamComplete(maxWaitMs: number = 45000): Promise<void> {
    const streamingCursor = this.page.locator("[class*='streamingCursor']");

    try {
      await streamingCursor.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      // If cursor never appeared, response might have been instant
      return;
    }

    await streamingCursor.waitFor({ state: "hidden", timeout: maxWaitMs });
  }

  async waitForTableUpdate(): Promise<void> {
    await this.page.waitForTimeout(500);
  }

  async retryWithLLMVariability<T>(
    action: () => Promise<T>,
    retries: number = 2,
    delayMs: number = 2000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let i = 0; i <= retries; i++) {
      try {
        return await action();
      } catch (error) {
        lastError = error as Error;
        if (i < retries) {
          await this.page.waitForTimeout(delayMs);
        }
      }
    }

    throw lastError;
  }
}
