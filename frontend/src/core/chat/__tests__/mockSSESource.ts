// SCAFFOLD: true — DISTILL RED scaffold for worker-tool-dispatch-refactor PR 0.
// Real impl is small (subscribe / emit / emitSequence). Tests in
// fe-event-vocabulary.feature verify subscribe semantics and ordering.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

import type { ChatEvent } from "../events";

export class MockSSESource {
  subscribe(_fn: (event: ChatEvent) => void): () => void {
    throw new Error(NOT_IMPLEMENTED);
  }
  emit(_event: ChatEvent): void {
    throw new Error(NOT_IMPLEMENTED);
  }
  async emitSequence(_events: ChatEvent[], _opts?: { delayMs?: number }): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
