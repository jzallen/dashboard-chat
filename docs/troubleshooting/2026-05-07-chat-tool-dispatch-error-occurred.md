# RCA: Chat tool dispatch emits `error_occurred` instead of `transform_applied`

**Date:** 2026-05-07
**Investigator:** nw-troubleshooter (dispatched by Mayor)
**Status:** Root cause identified with high confidence; minimal fix proposed; not implemented.

## 1. Symptoms

- **Failing tests** (both fail at the same chat-turn assertion):
  - `backend/tests/integration/dataset_layer/test_dataset_staging_layer.py::test_dataset_staging_layer`
  - `backend/tests/integration/dataset_layer/test_replay_idempotency.py::test_post_transforms_idempotency_and_replay_exactly_once`

- **Test-visible failure** (`test_replay_idempotency.py:245`):
  ```
  AssertionError: chat turn did not emit transform_applied on the SSE stream;
  saw event types: ['error_occurred', 'turn_done']
  ```

- **Wire-level failure** (captured live): the agent emits a `data-chat-event` of shape:
  ```json
  {"type":"error_occurred","phase":"backend_dispatch","message":"fetch failed",
   "failed_tool":"trimWhitespace","retryable":false}
  ```
  followed by `turn_done` with `reason: "stop"`. No `transform_applied` is ever produced.

- **Scope:** every chat turn that triggers any cleaning/mutation tool dispatcher in the running compose stack. The defect is **not test-specific** — it is a live-path defect that happens to be exposed only by these two integration tests because the unit/wire-contract tests mock the backend client.

## 2. Reproduction

### 2.1 Probe script (host → live compose stack)

Mint dev JWT via auth-proxy, create a project, upload a 2-row CSV with whitespace-laden `customer_email`, then POST to `http://localhost:1033/chat` with `harness.py::_drive_one_turn` payload shape:

```json
{
  "messages":[{"role":"user","content":"Trim whitespace on the customer_email column"}],
  "contextType":"dataset",
  "contextId":"019e00e1-8e9d-7153-ac52-5f46a13737b9",
  "project_id":"019e00e1-8e35-7f02-b8b5-7edc83db62ea",
  "thread_id":"probe-thread-1"
}
```

Captured SSE stream (verbatim):
```
data: {"type":"start","messageId":"7hgtYm65zLP0xLYw"}
data: {"type":"start-step"}
data: {"type":"data-chat-event","id":"evt-1778131243267-0",
       "data":{"type":"error_occurred","phase":"backend_dispatch","message":"fetch failed",
               "failed_tool":"trimWhitespace","retryable":false}}
data: {"type":"finish-step"}
data: {"type":"data-chat-event","id":"evt-1778131243270-0",
       "data":{"type":"turn_done","reason":"stop"}}
data: [DONE]
```

### 2.2 Backwards validation from inside the agent container
```
$ docker exec dashboard-chat-agent-1 node -e \
    "fetch('http://auth-proxy:3000/health').then(r=>r.text())..."

localhost:3000   FAIL  fetch failed       <-- exact string the agent emits
auth-proxy:3000  OK    {"status":"ok"}
```

### 2.3 Agent container env (smoking gun)
```
$ docker exec dashboard-chat-agent-1 env | grep -iE 'AUTH|BACKEND|URL'
JWKS_URL=http://api:8000/.well-known/jwks.json
REDIS_URL=redis://redis:6379/0
```
**`AUTH_PROXY_URL` is not set.**

## 3. Five-Whys causal chain

```
PROBLEM: chat turns that trigger a tool emit error_occurred("fetch failed")
         instead of transform_applied.

WHY 1: SSE carries error_occurred{phase=backend_dispatch, message="fetch failed",
       failed_tool=trimWhitespace}.
       [Evidence: §2.1 captured stream; matches test failure exactly.]

WHY 2: trimWhitespace dispatcher's execute() callback threw inside ctx.backend.post(),
       runWithEmit() catches and translates to error_occurred.
       [Evidence: dispatchers/_helpers.ts:30-48 (catch -> emit error_occurred);
        backend-client.ts:37-40 (fetch + throw on !ok); the message string
        "fetch failed" is the Node fetch native error for an unreachable host —
        not an HTTP error from a reachable server (which would surface as
        "POST /api/datasets/.../transforms failed: NNN" via BackendClientError).]

WHY 3: ctx.backend constructed with authProxyUrl="http://localhost:3000",
       which resolves to nothing inside the agent container.
       [Evidence: handleChat.ts:118-120 — `authProxyUrl: env.AUTH_PROXY_URL ?? "http://localhost:3000"`;
        agent container env (§2.3) shows AUTH_PROXY_URL unset, so fallback is taken;
        §2.2 proves http://localhost:3000 from inside agent container fails fetch
        while http://auth-proxy:3000 succeeds.]

WHY 4: handleChat reads AUTH_PROXY_URL from env arg, but startup wiring in
       agent/index.ts never reads process.env.AUTH_PROXY_URL nor threads it
       into chatEnv.
       [Evidence: agent/index.ts:69 builds
          `const chatEnv = { GROQ_API_KEY, GROQ_TEMPERATURE, threadPersister,
                             presentationStateLog };`
        — no AUTH_PROXY_URL field. Repo-wide grep returns exactly one production
        reference: handleChat.ts:119 (the consumer). No producer.]

WHY 5 (root cause): docker-compose.yml's `agent` service block does not declare
       AUTH_PROXY_URL, AND agent/index.ts does not pull it from process.env.
       Both halves of the wiring are missing. Defect introduced in commit 074627a
       (dc-8v9, "PR 0 scaffolding for worker-tool-dispatch-refactor", Apr 28)
       which added backend-client.ts referencing AUTH_PROXY_URL but did not wire
       the env var into either the container or the Hono process; later commits
       (PR 1 cleaning dispatchers, then a1d8c07 v6 migration) inherited the gap.
       The hardcoded `?? "http://localhost:3000"` fallback masked the missing
       wiring during dev-on-host smoke testing (where auth-proxy was commonly
       bound to host port 3000) but is unreachable from inside the agent
       container on the compose network.

ROOT CAUSE: Agent's outbound HTTP base URL for dispatcher backend calls is not
            configured. env.AUTH_PROXY_URL is undefined at runtime in compose
            because (a) docker-compose.yml does not pass it, and (b)
            agent/index.ts does not read process.env.AUTH_PROXY_URL into chatEnv.
            The hardcoded fallback http://localhost:3000 is only correct for
            developers running the agent with `npm run dev:agent` directly on
            the host — not for the containerized agent the integration tests
            target.
```

### Cross-validation against alternative hypotheses

| Hypothesis | Status | Evidence |
|---|---|---|
| H1: Tool definitions malformed (`parameters` vs `inputSchema`) | **Refuted** | Real failure has `failed_tool="trimWhitespace"` — Groq successfully selected the tool, the SDK successfully invoked the dispatcher's `execute()`. A schema mismatch would produce no tool call or a Zod parse error before `execute()` ran. |
| H2: `execute()` throws | **Confirmed but downstream** | Yes, this is WHY 2. The throw originates inside Node fetch, not in app code. |
| H3: JWT not forwarded | **Refuted** | The error message is `"fetch failed"` (Node native) not `"POST /api/datasets/... failed: 401"` (BackendClientError). The fetch never reaches a server. JWT forwarding is also code-verified intact: handleChat.ts:109 + backend-client.ts:25-28. |
| H4: channel/thread_id wiring | **Refuted** | `transform_applied` would be emitted regardless of `channelId` (cleaning.ts:71-77 pushes onto `eventBuffer` unconditionally; pipeChatStream flushes regardless of `channelId`). |

## 4. Proposed fix (minimal)

**Two-line wiring fix; no code logic changes:**

1. `docker-compose.yml`, `agent.environment` block — add:
   ```yaml
   AUTH_PROXY_URL: http://auth-proxy:3000
   ```

2. `agent/index.ts` line 69 — extend `chatEnv`:
   ```ts
   const AUTH_PROXY_URL = process.env.AUTH_PROXY_URL;
   const chatEnv = {
     GROQ_API_KEY,
     GROQ_TEMPERATURE,
     AUTH_PROXY_URL,        // <- new
     threadPersister,
     presentationStateLog,
   };
   ```
   The `Env` interface in `handleChat.ts:36-62` already declares `AUTH_PROXY_URL?: string` (line 38) — no type change needed.

**Optional hardening (recommended but separate scope):**
- Fail fast in `agent/index.ts` if `AUTH_PROXY_URL` is unset (matching the pattern at lines 28-31 for `GROQ_API_KEY`). The current silent fallback is the trap that hid this for ~10 days.
- Delete the `?? "http://localhost:3000"` fallback in `handleChat.ts:119` once the env is mandatory.
- Drop the legacy `parameters:`-shape tool definitions in `agent/lib/chat/tools.ts` and `reportToolDefinitions.ts` (separate bead — they're shadowed by dispatchers but waste tokens in the system prompt and risk Zod-validation drift).

## 5. Acceptance signal

The fix is confirmed when, after a rebuild + `docker compose up -d`:

1. `docker exec dashboard-chat-agent-1 env | grep AUTH_PROXY_URL` shows `AUTH_PROXY_URL=http://auth-proxy:3000`.
2. The §2.1 probe (host → `:1033/chat` with a `dataset` context) emits a `data-chat-event` of type `transform_applied` carrying `transform_id` and `dataset_id`, **before** `turn_done`. No `error_occurred` event appears.
3. Both originally failing tests pass:
   - `uv run --env-file ../.env pytest -v backend/tests/integration/dataset_layer/test_dataset_staging_layer.py::test_dataset_staging_layer`
   - `uv run --env-file ../.env pytest -v backend/tests/integration/dataset_layer/test_replay_idempotency.py::test_post_transforms_idempotency_and_replay_exactly_once`
4. No regression in the 7 currently-green tests in `backend/tests/integration/dataset_layer/`.

## 6. Confidence and what would refute this

- **Confidence:** Very high. The error message string `"fetch failed"` is Node's native fetch failure for an unreachable host, captured live; the unreachable URL is directly traceable to a missing env var via static reading of `agent/index.ts:69` and `docker-compose.yml`; and the same URL is provably reachable from inside the agent container under the corrected hostname.

- **What would refute it:** If, after applying the fix, the chat turn still emits `error_occurred`. Two plausible follow-on failures (lower probability, would surface as different error messages):
  - Backend `POST /api/datasets/{id}/transforms` returns 4xx/5xx for the dispatcher's request body shape under v6 (would surface as `error_occurred{message: "POST /api/datasets/... failed: NNN"}` — a different string).
  - The dispatcher's `expression_config` shape (cleaning.ts:34-39) drifted from the backend's transform schema (would surface as a 400 with validation error in `BackendClientError.body`).
  Both testable independently with a `curl` against `:1032/api/datasets/{id}/transforms` once a real `dataset_id` exists.

## 7. Files cited (absolute paths)

**Defect:**
- `/workspaces/dashboard-chat/agent/index.ts:69` — missing producer
- `/workspaces/dashboard-chat/agent/lib/chat/handleChat.ts:38,109,118-120` — consumer + hardcoded fallback
- `/workspaces/dashboard-chat/agent/lib/chat/backend-client.ts:22-48` — fetch wrapper
- `/workspaces/dashboard-chat/agent/lib/chat/dispatchers/cleaning.ts:56-79` — dispatch flow + emit site
- `/workspaces/dashboard-chat/agent/lib/chat/dispatchers/_helpers.ts:29-48` — runWithEmit error translation
- `/workspaces/dashboard-chat/docker-compose.yml` (agent service env block) — missing declaration

**Test sites:**
- `/workspaces/dashboard-chat/backend/tests/integration/dataset_layer/test_replay_idempotency.py:233-249` — assertion site
- `/workspaces/dashboard-chat/backend/tests/integration/dataset_layer/harness.py:585-616` — `_drive_one_turn` payload shape

**Code-hygiene follow-up (separate bead, not this fix):**
- `/workspaces/dashboard-chat/agent/lib/chat/tools.ts` — uses v4 `parameters:` shape (lines 19, 46, 52, 58, 64, 71, 78, 85, 95, 104, 111)
- `/workspaces/dashboard-chat/agent/lib/chat/reportToolDefinitions.ts` — same v4 shape across multiple lines
