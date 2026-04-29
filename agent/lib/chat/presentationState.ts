/**
 * Per-channel reflect-only directive log (ADR-015 / dc-x3y.2.2).
 *
 * Worker UI dispatchers append to this log as a side effect of their existing
 * `emit(directive)` call. Headless consumers read the log via
 * `GET /api/channels/{id}/presentation-state` and replay through
 * `applyDirective` (`@dashboard-chat/shared-chat/applyDirective`) to
 * reconstruct TanStack table presentation state without driving a browser.
 *
 * This is a side channel; it does NOT call `BackendClient.post`, preserving
 * the worker test invariant at `worker-tool-dispatch.test.ts:502-550`.
 *
 * Persistence backend choice: in-process Map. Aligns with C.1's same-process
 * persistence pattern (the worker's Stream.io persister also keeps state in
 * the agent process). The default is suitable for dev / single-worker
 * deployment; replace with a Redis-backed implementation when the worker
 * scales horizontally (per ADR-015 §"Cross-decision composition").
 */

import type { UiDirective } from "@dashboard-chat/shared-chat/events";

export type PresentationStateLogEntry = {
  channel_id: string;
  directives: UiDirective[];
  last_event_at: string;
};

/**
 * Append-only per-channel log of UI directives. Implementations must be
 * append-only — a `get` returns the directives in append order. Append is
 * fire-and-forget from the dispatcher's perspective: a thrown error is
 * isolated by the caller; the SSE emit (the user-facing contract) is not
 * affected.
 */
export interface PresentationStateLog {
  append(channelId: string, directive: UiDirective): Promise<void>;
  get(channelId: string): Promise<PresentationStateLogEntry>;
}

type ChannelEntry = { directives: UiDirective[]; lastEventAt: string };

export class InProcessPresentationStateLog implements PresentationStateLog {
  private readonly channels = new Map<string, ChannelEntry>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async append(channelId: string, directive: UiDirective): Promise<void> {
    if (!channelId) return;
    const existing = this.channels.get(channelId);
    const entry: ChannelEntry = existing ?? { directives: [], lastEventAt: "" };
    entry.directives.push(directive);
    entry.lastEventAt = this.now().toISOString();
    if (!existing) this.channels.set(channelId, entry);
  }

  async get(channelId: string): Promise<PresentationStateLogEntry> {
    const entry = this.channels.get(channelId);
    return {
      channel_id: channelId,
      directives: entry ? [...entry.directives] : [],
      last_event_at: entry?.lastEventAt ?? "",
    };
  }

  /** Test/admin helper: drop all stored channels. Not part of the interface. */
  reset(): void {
    this.channels.clear();
  }
}

/**
 * Default no-op log used when no channel id is plumbed through (e.g. legacy
 * /chat callers that omit `thread_id`). Append is a no-op; `get` returns an
 * empty entry.
 */
export const noopPresentationStateLog: PresentationStateLog = {
  async append() {
    /* no-op */
  },
  async get(channelId: string) {
    return { channel_id: channelId, directives: [], last_event_at: "" };
  },
};

/**
 * Default singleton used by the production agent. Tests should construct a
 * fresh `InProcessPresentationStateLog` per case to avoid cross-test bleed.
 */
export const inProcessPresentationStateLog = new InProcessPresentationStateLog();
