# Upstream Issues — worker-tool-dispatch-refactor (DISTILL findings)

DISTILL surfaced two gaps that DESIGN didn't address. Neither contradicts DISCUSS or DESIGN's locked decisions; both are unstated assumptions that needed a default before acceptance tests could be written. Resolved below; documented here so DELIVER (and any future revisits) sees the trade-off.

---

## UI-1 — DESIGN assumes a `shared/chat/` workspace that doesn't exist

**Where**: `design/design.md` §3 ("The schema lives in **one file shared by worker and frontend** via npm workspace import (the existing `shared/chat/` workspace already follows this pattern)"). Also referenced in §5 PR 0 file list (`shared/chat/events.ts` (NEW or extend existing shared types)).

**Reality**: `package.json` declares `workspaces: ["frontend", "agent", "auth-proxy"]`. There is no `shared/` directory at the repo root and no `shared/chat/` package. CLAUDE.md mentions `shared/chat/` aspirationally but no such code exists. Frontend types and agent types currently live in their respective trees with no cross-import.

**Resolution (DISTILL-time, see TWD-8)**: scaffolds live in `agent/lib/chat/events.ts` (canonical Zod schema) and `frontend/src/core/chat/events.ts` (re-export from agent OR verbatim duplicate). DISTILL's acceptance scenarios assert **runtime schema equivalence** (every worker-emitted event parses against the FE schema, vice versa) so the location decision is movable at DELIVER time without test churn.

**Polecat options at DELIVER time**:
1. Verbatim duplicate + a one-line sync test (`expect(agentSchema).toEqual(frontendSchema)`). Smallest change.
2. Frontend re-exports from agent via relative path. Single source of truth at file level, but creates a frontend → agent file dependency that confuses some bundlers.
3. Add a real `shared/` workspace, move events.ts there, both packages import from it. Most disciplined; biggest change.

**Recommendation**: option 1 for PR 0; option 3 if-and-when a third client appears. Option 2 has no winners.

---

## UI-2 — DESIGN's "LLM-mocking forbidden" principle vs. acceptance-test determinism + cost

**Where**: `design/design.md` §8 ADR Alternatives row ("LLM-mocking in tests (forbidden by upstream production-fidelity principle)").

**Reality**: Holding the principle absolutely turns every PR-1/2/3 acceptance scenario into a real Groq call — N×$cost per CI run, plus rate-limit and non-determinism flake. The principle was articulated in the context of `api-driven-user-flow-tests` to forbid replacing Groq with a hand-written stub that drifts from production behavior. It does not forbid **replaying a real Groq response captured against the running model**.

**Resolution (DISTILL-time, see TWD-2)**: walking-skeleton uses real Groq under `@requires_external` (skips without `GROQ_API_KEY`). Per-tool-family scenarios use **fixture-replay**: capture one real Groq response for each tool dispatch path during walking-skeleton runs, replay that captured-bytes-on-the-wire fixture in subsequent scenarios. The fixture **is** Groq's output; only the network call is replaced. If Groq's response shape changes, the next walking-skeleton run regenerates fixtures and the replays update mechanically.

This preserves "production-fidelity" (real-Groq-output is what the test asserts against) while making CI deterministic and cheap.

**Required infrastructure (PR 0)**: a small fixture-recording harness (`agent/test/chat/fixtures/groq-replay.ts`), conventions for fixture file naming (`fixtures/<tool-family>/<scenario>.json`), and a "regenerate fixtures" npm script for when the model version is upgraded.

**Polecat options at DELIVER time**:
1. Build the fixture-replay harness as part of PR 0. Walking skeleton becomes the seed run that produces fixtures.
2. Adopt MSW (Mock Service Worker) on the Groq endpoint. Heavier; a learning curve.
3. Use `@ai-sdk/test`'s in-memory model. Closer to mocking the LLM than DESIGN allows; reject.

**Recommendation**: option 1.

---

## Non-issues (checked)

- **DISCUSS Q1 vocabulary vs. DESIGN §3 vocabulary**: DESIGN refines (adds `filters_cleared`, enriches `transform_applied`), does not contradict. DISCUSS Q1 explicitly authorizes DESIGN to refine ("starting names; DESIGN may refine").
- **DISCUSS Q5 migration plan vs. DESIGN §5 PR plan**: identical (3 family PRs + scaffolding).
- **DISCUSS Q7 partial-progress + tool.execute pattern**: DESIGN §1 implements verbatim.
- **DESIGN D11 `transformStreamForResolveDataset` carve-out**: out of scope for PR 0/1/2/3, documented as known asymmetry. DISTILL writes no scenarios for this path; existing tests in `agent/test/chat/resolveDataset.test.ts` cover it and survive the refactor.
