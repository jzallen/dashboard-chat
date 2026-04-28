# Walking Skeleton — worker-tool-dispatch-refactor

> **SSOT**: `agent/test/chat/acceptance/walking-skeleton.feature` (the `.feature` file is documentation; the runnable skeleton lives at `agent/test/chat/acceptance/walking-skeleton.test.ts`).
> **Status**: drafted in DISTILL as `@pending @skip @walking_skeleton`. Un-skipped by the polecat dispatched on PR 1.
> **Strategy**: B (real local + fake costly) — see `wave-decisions.md` TWD-2.

## Single scenario

```gherkin
Scenario: Trim whitespace via chat propagates end-to-end as a typed event
  Given the dev compose stack is running (frontend, agent, auth-proxy, backend, query-engine, minio)
    And a project owned by dev-user-001 with one CSV uploaded as a parquet dataset
    And one column "region" contains rows with leading or trailing whitespace
    And GROQ_API_KEY is set in the agent environment
  When the test POSTs to http://localhost:<agent-port>/chat with a Bearer JWT
    And the chat message body is "Trim whitespace on the region column"
  Then the SSE stream from the agent emits at least one event of type "transform_applied"
    And the emitted event's "column" field equals "region"
    And the emitted event's "operation" field equals "trim"
    And the emitted event's "dataset_id" field matches the uploaded dataset
    And the SSE stream emits no raw Groq tool-call deltas
    And subsequently GET /api/datasets/<id>?include_preview=true returns 200
    And the preview rows show no whitespace-only differences in the region column
```

Tags: `@walking_skeleton @real-io @requires_external @driving_adapter @kpi`

## Why this scenario

This is the thinnest end-to-end slice that:
- Hits the agent's HTTP `/chat` driving port (TWD-5).
- Routes through real Groq, real auth-proxy, real backend (TWD-2 strategy B).
- Produces the new typed event vocabulary (Story 1 / AC1.1, AC1.2 — and incidentally K2 by negative assertion of "no raw tool-call deltas").
- Is observable from a vitest spec without booting a browser.
- Maps to a path that's already exercised by humans during manual testing of the staging layer (proof: dc-7ns / hq-c2u bug reports came from this exact flow — the new architecture must continue to satisfy that flow).

## Why ONE scenario, not several

Methodology mandate: exactly one `@walking_skeleton` scenario per feature. Additional happy paths (mutations, UI directives) and error paths get their own non-skeleton scenarios in PR 2 / PR 3 feature files.

## Driving-adapter coverage check

DESIGN names exactly one driving port: HTTP `POST /chat` SSE on the agent. The walking skeleton invokes it via `fetch()` against the running agent on `localhost`. Exit-code-equivalent assertion: HTTP 200 + the event is parseable. Output-format assertion: the SSE event lines are valid JSON conforming to `ChatEventSchema`. Argument-handling assertion: the JWT in the `Authorization` header is forwarded to auth-proxy → backend (verified indirectly by the fact that the transform persists under the dev user).

No other driving ports exist for this feature.

## What this skeleton does NOT cover

- Error paths (Q7's "continue past errors") — separate scenarios in PR 1/2/3.
- Direct-UI click handlers — covered by FE component tests (Story 2 / AC2.4).
- Other tool families (mutations, UI directives) — separate scenarios in PR 2 / PR 3.
- The `transformStreamForResolveDataset` carve-out (DESIGN D11) — out of scope; existing tests retain it.
- Schema validation at the FE boundary — separate FE component scenarios.

## Lifecycle

1. **DISTILL**: scenario drafted as `@pending @skip`. Vitest spec exists; throws "Not yet implemented — RED scaffold" because the dispatcher modules don't exist yet.
2. **DELIVER PR 0**: scaffolding lands. Walking-skeleton vitest spec is **still skipped** (PR 0 by definition ships no behavior change; nothing to assert against). RED scaffolds in `agent/lib/chat/dispatchers/cleaning.ts` etc. start raising assertion errors but the orchestration that wires them isn't there yet.
3. **DELIVER PR 1**: walking-skeleton un-skipped. The `applyCleaningTransform` dispatcher implementation makes it green. The polecat owns the un-skip in the same diff that ships the dispatcher.
4. **Post-PR 1**: walking-skeleton is a permanent guard. Any change that breaks this scenario is a regression on the protocol contract.
