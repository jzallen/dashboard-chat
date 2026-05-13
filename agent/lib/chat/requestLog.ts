// In-memory request-log for US-207 + US-208 harness assertions.
//
// Captures the X-Active-Scope, body's session_id, and a few request shape
// fields per chat turn so the TS harness can assert (a) every turn carried
// a scope and (b) no mid-switch turn paired an old project_id with a new
// session_id (IC-J002-4 atomicity).
//
// Gated by NWAVE_HARNESS_KNOBS=true (set in compose's dev profile, never in
// prod). When the flag is off, capture is a no-op and the debug endpoints
// 404.
//
// Ring-buffered at 200 entries — enough for the harness to observe a switch
// window without unbounded memory growth.

import type { ActiveScope } from "./scope";

export interface RequestLogEntry {
  ts: string;
  scope: ActiveScope | null;
  session_id: string | null;
  /** The request's `thread_id` (channelId); often the same as session_id but
   *  not always (e.g., agent's resolve-dataset path). */
  thread_id: string | null;
  /** Status returned (200, 400, 403). Reasoning: scope-rejection scenarios
   *  need to assert the agent CHOSE not to call the LLM. */
  status: number;
}

const MAX_ENTRIES = 200;

class InProcessRequestLog {
  private entries: RequestLogEntry[] = [];

  enabled(): boolean {
    return process.env.NWAVE_HARNESS_KNOBS === "true";
  }

  append(entry: RequestLogEntry): void {
    if (!this.enabled()) return;
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  last(): RequestLogEntry | null {
    if (this.entries.length === 0) return null;
    return this.entries[this.entries.length - 1];
  }

  all(): RequestLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

export const requestLog = new InProcessRequestLog();
