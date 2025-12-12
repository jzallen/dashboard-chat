import { Page, expect } from "@playwright/test";

export class ChatHelper {
  constructor(private page: Page) {}

  get input() {
    return this.page.locator('input[placeholder="Type a command..."]');
  }

  get sendButton() {
    return this.page.locator('button[type="submit"]');
  }

  get messageRows() {
    return this.page.locator('[class*="messageRow"]');
  }

  get assistantMessages() {
    return this.page.locator('[class*="messageRowAssistant"]');
  }

  get lastAssistantMessage() {
    return this.assistantMessages.last();
  }

  get streamingCursor() {
    return this.page.locator('[class*="streamingCursor"]');
  }

  async sendMessage(message: string): Promise<void> {
    await this.input.fill(message);
    await this.sendButton.click();

    // Wait for streaming to start
    await expect(this.streamingCursor).toBeVisible({ timeout: 15000 });

    // Wait for streaming to complete (cursor disappears)
    await expect(this.streamingCursor).toBeHidden({ timeout: 45000 });
  }

  async sendMessageAndWaitForToolExecution(message: string): Promise<void> {
    await this.sendMessage(message);

    // Give table state time to update after tool execution
    await this.page.waitForTimeout(500);
  }

  async getLastResponse(): Promise<string> {
    const content = this.lastAssistantMessage.locator('[class*="messageContent"]');
    return (await content.textContent()) || "";
  }

  async responseContainsToolCall(toolName: string): Promise<boolean> {
    const toolCalls = this.lastAssistantMessage.locator('[class*="toolCall"]');
    const count = await toolCalls.count();

    for (let i = 0; i < count; i++) {
      const text = await toolCalls.nth(i).textContent();
      if (text?.toLowerCase().includes(toolName.toLowerCase())) {
        return true;
      }
    }
    return false;
  }
}
