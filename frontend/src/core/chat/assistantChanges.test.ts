import { describe, expect, it } from "vitest";

import { deriveAssistantChanges } from "./assistantChanges";
import type { Message } from "./types";

// MR-5 — deriveAssistantChanges: distill assistant tool-calls into audit entries.
describe("deriveAssistantChanges", () => {
  it("maps each assistant tool-call to an audit entry, preserving order", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "filter by status" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc-1",
            type: "function",
            function: { name: "filterTable", arguments: '{"column":"status","value":"active"}' },
          },
          {
            id: "tc-2",
            type: "function",
            function: { name: "sortTable", arguments: '{"column":"amount","direction":"desc"}' },
          },
        ],
      },
    ];
    const changes = deriveAssistantChanges(messages);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ id: "tc-1", tool: "filterTable" });
    expect(changes[0].summary).toContain("status");
    expect(changes[0].summary).toContain("active");
    expect(changes[1]).toMatchObject({ id: "tc-2", tool: "sortTable" });
  });

  it("ignores user messages and assistant messages without tool-calls", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello, how can I help?" },
    ];
    expect(deriveAssistantChanges(messages)).toEqual([]);
  });

  it("falls back to the raw argument string when arguments are not valid JSON", () => {
    const messages: Message[] = [
      {
        id: "a1",
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "tc-1", type: "function", function: { name: "doThing", arguments: "not-json" } },
        ],
      },
    ];
    const changes = deriveAssistantChanges(messages);
    expect(changes).toHaveLength(1);
    expect(changes[0].summary).toBe("not-json");
  });

  it("returns an empty list for an empty conversation", () => {
    expect(deriveAssistantChanges([])).toEqual([]);
  });
});
