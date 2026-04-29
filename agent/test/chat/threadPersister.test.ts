import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ChatEvent } from "../../lib/chat/events";
import {
  DOMAIN_EVENT_TYPES,
  isDomainEvent,
  noopThreadPersister,
  UI_DIRECTIVE_TYPES,
} from "../../lib/chat/threadPersister";

describe("threadPersister classifier", () => {
  it("isDomainEvent returns true for every domain event type", () => {
    const samples: ChatEvent[] = [
      {
        type: "transform_applied",
        transform_id: "t-1",
        dataset_id: "d-1",
        operation: "trim",
        column: "c",
      },
      { type: "row_added", dataset_id: "d-1", row_id: "r-1" },
      { type: "row_deleted", dataset_id: "d-1", row_id: "r-1" },
      {
        type: "column_renamed",
        dataset_id: "d-1",
        old_name: "a",
        new_name: "b",
      },
      {
        type: "transform_undone",
        transform_id: "t-1",
        dataset_id: "d-1",
        mode: "disable",
      },
      { type: "transform_re_enabled", transform_id: "t-1", dataset_id: "d-1" },
      {
        type: "error_occurred",
        phase: "backend_dispatch",
        message: "boom",
        retryable: false,
      },
      { type: "turn_done", reason: "stop" },
    ];
    for (const sample of samples) {
      expect(isDomainEvent(sample)).toBe(true);
    }
  });

  it("isDomainEvent returns false for every UI directive type (ADR-014: directives are out of replay scope)", () => {
    const samples: ChatEvent[] = [
      { type: "sort_directive", column: "c", direction: "asc" },
      { type: "filter_directive", column: "c", filters: [] },
      { type: "filters_cleared" },
    ];
    for (const sample of samples) {
      expect(isDomainEvent(sample)).toBe(false);
    }
  });

  it("isDomainEvent returns false for assistant_text_delta (text streaming, not a state-change outcome)", () => {
    expect(isDomainEvent({ type: "assistant_text_delta", delta: "hi" })).toBe(
      false,
    );
  });

  it("DOMAIN_EVENT_TYPES and UI_DIRECTIVE_TYPES are disjoint", () => {
    for (const t of DOMAIN_EVENT_TYPES) {
      expect(UI_DIRECTIVE_TYPES.has(t)).toBe(false);
    }
  });
});

describe("DOMAIN_EVENT_TYPES cross-language parity (TS schema ↔ Python mirror)", () => {
  // ADR-014 stratifies the wire schema; the persistence/replay scope is a
  // strict subset of `DomainEventSchema` (currently: schema minus
  // `assistant_text_delta`). The TS allowlist is now derived from the schema
  // automatically. The Python mirror at
  // `backend/app/use_cases/session/event_replay.py:DOMAIN_EVENT_TYPES` is
  // hand-written and must stay in sync — this test is the mechanical guard.
  // (Bead dc-ora.)

  const REPO_ROOT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const PY_PATH = resolve(
    REPO_ROOT,
    "backend/app/use_cases/session/event_replay.py",
  );

  function readPythonDomainEventTypes(): Set<string> {
    const source = readFileSync(PY_PATH, "utf8");
    const blockMatch = source.match(
      /DOMAIN_EVENT_TYPES\s*:\s*frozenset\[str\]\s*=\s*frozenset\(\s*\{([\s\S]*?)\}\s*\)/,
    );
    if (!blockMatch) {
      throw new Error(
        `Could not locate \`DOMAIN_EVENT_TYPES: frozenset[str] = frozenset({...})\` in ${PY_PATH}. ` +
          "If you renamed the symbol or changed its literal shape, update the regex in this test.",
      );
    }
    const literals = [...blockMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return new Set(literals);
  }

  it("the Python `DOMAIN_EVENT_TYPES` frozenset matches the TS allowlist exactly", () => {
    const tsTypes = new Set(DOMAIN_EVENT_TYPES);
    const pyTypes = readPythonDomainEventTypes();

    const missingFromPython = [...tsTypes]
      .filter((t) => !pyTypes.has(t))
      .sort();
    const extraneousInPython = [...pyTypes]
      .filter((t) => !tsTypes.has(t))
      .sort();

    if (missingFromPython.length > 0 || extraneousInPython.length > 0) {
      const lines: string[] = [
        "DOMAIN_EVENT_TYPES drift between TS and Python (ADR-014, dc-ora).",
        `  TS source:     shared/chat/events.ts:DomainEventSchema (minus assistant_text_delta)`,
        `  Python mirror: backend/app/use_cases/session/event_replay.py:DOMAIN_EVENT_TYPES`,
      ];
      if (missingFromPython.length > 0) {
        lines.push(
          `  → Add to event_replay.py:DOMAIN_EVENT_TYPES: ${missingFromPython
            .map((t) => `"${t}"`)
            .join(", ")}`,
        );
      }
      if (extraneousInPython.length > 0) {
        lines.push(
          `  → Remove from event_replay.py:DOMAIN_EVENT_TYPES (not in TS schema): ${extraneousInPython
            .map((t) => `"${t}"`)
            .join(", ")}`,
        );
      }
      throw new Error(lines.join("\n"));
    }

    expect(pyTypes).toEqual(tsTypes);
  });

  it("Python mirror explicitly excludes `assistant_text_delta` (ADR-014: text streaming, not a state-change outcome)", () => {
    const pyTypes = readPythonDomainEventTypes();
    expect(pyTypes.has("assistant_text_delta")).toBe(false);
  });
});

describe("noopThreadPersister", () => {
  it("resolves without throwing for any input", async () => {
    await expect(
      noopThreadPersister.persist("channel-1", [
        { type: "row_added", dataset_id: "d-1", row_id: "r-1" },
      ]),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing for empty event list and missing channel id", async () => {
    await expect(noopThreadPersister.persist("", [])).resolves.toBeUndefined();
  });
});
