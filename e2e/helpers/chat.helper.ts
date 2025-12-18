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
    const assistantCountBefore = await this.assistantMessages.count();

    await this.input.fill(message);
    await this.sendButton.click();

    // Wait for new assistant message to appear
    await expect(this.assistantMessages).toHaveCount(assistantCountBefore + 1, {
      timeout: 60000,
    });

    // Wait for assistant message to have content (not just empty/loading)
    const newAssistantMessage = this.assistantMessages.nth(assistantCountBefore);
    await expect(newAssistantMessage.locator('[class*="messageContent"]')).not.toBeEmpty({
      timeout: 60000,
    });
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
