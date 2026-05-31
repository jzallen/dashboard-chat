// Assistant-changes derivation — pure core (MR-5).
//
// Suite authored by DISTILL (path-forward.md §2.5 "Assistant changes" audit
// panel); body implemented at DELIVER. Per-model audit provenance is NOT served
// by any backend endpoint today and the Session/Message/ToolCall shapes carry no
// model id (DISTILL decision DWD-M5-5 / upstream-issues UI-5). The provenance
// that IS available client-side is the live chat session bound to the current
// model via setContext: the assistant tool-calls in `useChatContext().messages`.
// This helper distills those into displayable audit entries. The richer PERSISTED
// cross-session per-model feed is a deferred (c) — see upstream-issues.md.
//
// Framework-free and testable in isolation. RED scaffold (created by DISTILL).
import type { Message } from "./types";

export const __SCAFFOLD__ = true;

export interface AssistantChange {
  /** Tool-call id (stable key). */
  id: string;
  /** The tool/function the assistant invoked. */
  tool: string;
  /** Human-readable one-line summary of the call arguments. */
  summary: string;
}

/**
 * Distill the assistant tool-calls in a chat message list into audit entries,
 * preserving message order then tool-call order. Messages without `tool_calls`
 * (and non-assistant messages) contribute nothing.
 */
export function deriveAssistantChanges(_messages: Message[]): AssistantChange[] {
  throw new Error(
    "Not yet implemented — RED scaffold (MR-5 deriveAssistantChanges)",
  );
}
