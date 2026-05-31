// Assistant-changes derivation — pure core (MR-5).
//
// Per-model audit provenance is NOT served by any backend endpoint today and the
// Session/Message/ToolCall shapes carry no model id (DISTILL decision DWD-M5-5 /
// upstream-issues UI-5). The provenance that IS available client-side is the live
// chat session bound to the current model via setContext: the assistant tool-calls
// in `useChatContext().messages`. This helper distills those into displayable audit
// entries. The richer PERSISTED cross-session per-model feed is a deferred (c).
//
// Framework-free and testable in isolation.
import type { Message } from "./types";

export interface AssistantChange {
  /** Tool-call id (stable key). */
  id: string;
  /** The tool/function the assistant invoked. */
  tool: string;
  /** Human-readable one-line summary of the call arguments. */
  summary: string;
}

function formatValue(value: unknown): string {
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}

/** One-line, human-readable summary of a tool-call's JSON argument string. */
function summarizeArguments(args: string): string {
  try {
    const parsed = JSON.parse(args);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => `${key}=${formatValue(value)}`)
        .join(", ");
    }
    return String(parsed);
  } catch {
    return args;
  }
}

/**
 * Distill the assistant tool-calls in a chat message list into audit entries,
 * preserving message order then tool-call order. Messages without `tool_calls`
 * (and non-assistant messages) contribute nothing.
 */
export function deriveAssistantChanges(messages: Message[]): AssistantChange[] {
  const changes: AssistantChange[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    for (const call of message.tool_calls) {
      changes.push({
        id: call.id,
        tool: call.function.name,
        summary: summarizeArguments(call.function.arguments),
      });
    }
  }
  return changes;
}
