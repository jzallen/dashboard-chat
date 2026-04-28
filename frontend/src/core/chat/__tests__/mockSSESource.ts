import type { ChatEvent } from "../events";

type Listener = (event: ChatEvent) => void;

export class MockSSESource {
  private listeners: Listener[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(event: ChatEvent): void {
    for (const listener of this.listeners.slice()) {
      listener(event);
    }
  }

  async emitSequence(events: ChatEvent[], opts?: { delayMs?: number }): Promise<void> {
    const delay = opts?.delayMs ?? 0;
    for (const event of events) {
      this.emit(event);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}
