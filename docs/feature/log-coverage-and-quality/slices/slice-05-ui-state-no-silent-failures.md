# Slice 05 — ui-state Redis/SSE logging + kill silent catches

**Story:** US-5 · **Sub-job:** SJ-5 · **Surface:** ui-state (+ ui chat/SSE) · **Effort:** ~1 day

## Goal (one sentence)
Remove the swallowed-failure blind spots in ui-state (and the ui chat/SSE path) so every best-effort failure is logged at WARN/ERROR with context, while keeping the best-effort paths non-throwing.

## IN scope
- Log Redis append/read/subscribe/touch (`lib/persistence/redis.ts`): DEBUG on success, WARN/ERROR on failure, with `flow_id` + correlation id.
- Log every best-effort `catch` on a catalogued critical path (state bookkeeping ~line 648, persist ~line 221) instead of swallowing; **keep them non-throwing**.
- Log SSE errors server-side in addition to the client-facing error event (`router.ts:904-905`).
- `LOG_LEVEL` support for ui-state; preserve + extend the existing `request_id`/`principal_id` `logTransition` pattern (`flow-router.ts`).
- (ui) log the swallowed chat fetch error (`Chat.tsx` ~line 152) and SSE stream error (`chat-stream.ts`) — the client-side half of "no silent failures".

## OUT scope
- ui SSR/BFF relay + `entry.server.tsx` logging (Slice 06).
- Replacing the existing transition-log mechanism (it is extended, not rewritten).

## Learning hypothesis
**Disproves** that the best-effort `catch` blocks can all be made to log **without** changing their best-effort (non-throwing) semantics. If adding a log forces a behavior change (e.g. a throw that breaks a keep-alive), the error-handling contract needs revisiting, not just instrumentation.
**Confirms** (if it succeeds) that observability can be added to best-effort paths without altering their resilience.

## Acceptance criteria
- AC1: Redis append/read/subscribe/touch log DEBUG (success) and WARN/ERROR (failure) with `flow_id` + correlation id.
- AC2: Zero empty `catch {}` remain on catalogued ui-state critical paths; each logs with context and stays non-throwing.
- AC3: SSE errors are logged server-side (plus the existing client error event), with the correlation id.
- AC4: ui-state honours `LOG_LEVEL`; the existing transition-log pattern still emits and now shares the standard envelope.

## Dependencies
Uses the Node logger (Slice 01) and correlation id (Slice 02). ui-state already has the closest existing pattern, so this is the smallest backend gap.

## Pre-slice SPIKE
Not required.

## Reference class
EXTEND of ui-state's existing structured `logTransition` + `requestIdMiddleware`; the work is generalizing that pattern to the silent Redis/SSE/best-effort paths.
