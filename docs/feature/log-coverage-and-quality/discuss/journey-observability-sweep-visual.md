# Journey (visual) — Diagnosing a cross-service failure through the logs

**Wave:** DISCUSS · **Area:** cross-cutting · **Job:** JOB-004 · **Provisional journey:** J-008 (Operator observability)

The "user" here is an **on-call engineer / developer** (and a **security reviewer**
for the audit dimension) — not an end user. The journey is the diagnosis loop that
the logs must support. Today it dead-ends at the first silent hop; this feature
makes it complete. Every step has a concrete observable (a log line, a grep
result, an error-response field).

## Mental model (operator's vocabulary)

- "A user told me **the chat failed**. I have a timestamp and maybe a screenshot."
- "I want **one id** I can grep that shows me everything that request touched."
- "When I find the failing service, I want the log to **tell me why** — not just
  that a 500 happened."
- "If it was an **auth rejection**, I need the reason and who it was — without the
  token showing up in the log."
- "During the incident I want to **turn up the detail** without redeploying."

The operator does not think in "pino vs consola", "AsyncLocalStorage", or "ECS
fields". Those are implementation concerns the envelope keeps consistent so the
operator only ever reads `event.module` / `event.action` / `attributes`.

## Happy path + emotional arc

```
 STEP 1             STEP 2              STEP 3              STEP 4               STEP 5
 Get the         →  Grep one        →   Read the         →  Read the          →  Turn up detail
 correlation id     id across all       failing hop's       decision reason       (if needed)
 ───────────        services           entry/exit          ───────────           ───────────
 from the error     ───────────        ───────────         WARN line names       LOG_LEVEL=debug
 response /         every service's     INFO start + the     the rejected JWT/     re-run; DEBUG
 user report        log line shares     ERROR with stack     denied access +       lines appear,
                    the same id         + tenant context     principal (no token)  no redeploy

 emotion:           emotion:            emotion:            emotion:              emotion:
 "where do I        "there it is —      "okay, it failed    "now I know WHY,      "I can see exactly
  even start?"       the whole path"     HERE, and why"       and who"              what it did"
  (anxious)          (oriented)          (closing in)         (confident)           (in control)

 confidence:  ▁▁▁▁▁▁→▃▃▃▃▃▃→▅▅▅▅▅▅→▆▆▆▆▆▆→███████  (builds monotonically)
```

## Error / recovery paths (failure modes of the *diagnosis*, which the feature removes)

| Where | Failure today | Target behavior | Recovery |
|---|---|---|---|
| Step 1 | Error response carries no correlation id | Error responses include `correlation_id` (header + body) | Operator copies the id from the response/user report |
| Step 2 | The id stops at the first hop (not propagated) | Every downstream hop logs the same `correlation_id` (bound via `AsyncLocalStorage`/`contextvars`) | Operator greps one id across all five surfaces |
| Step 3 | The failing hop logged nothing (silent catch / happy-path silence) | INFO entry/exit on every critical path; WARN/ERROR with context on every failure; **zero** empty catches on catalogued paths | Operator reads the start marker + the error |
| Step 4 | Auth rejection had no logged reason | Every auth decision logs outcome + reason + principal, **never** the credential | Operator reads the WARN reason and the `principal_id` |
| Step 5 | No way to raise verbosity without redeploy | `LOG_LEVEL` honoured at runtime by every service | Operator sets `LOG_LEVEL=debug`, re-runs, reverts after |
| Any | A log line leaks a token/cookie/secret/PII | Centralized redaction drops known-sensitive keys; regression-tested | N/A — the leak can't ship |

## Step → expected output table

| Step | Entry point | Expected observable output |
|---|---|---|
| 1 Get id | Error HTTP response (any surface) | Response body/header contains `correlation_id` |
| 2 Grep | `grep <id>` over each service's stdout/log sink | Every service's lines for that request share the `correlation_id` field |
| 3 Failing hop | the failing service's logs | An INFO `*.start` and either an INFO `*.ok` or a WARN/ERROR with `event.action`, `attributes`, stack where available, and tenant context |
| 4 Decision reason | auth-proxy / backend logs | auth-proxy: WARN `auth.<kind>.rejected` with `reason` + `principal_id`/`client_id`, no token. backend: INFO/WARN on DomainException outcome with `org_id`/`user_id` |
| 5 Raise detail | `LOG_LEVEL=debug` env on the service | DEBUG lines (payloads sans secrets, branch decisions) appear after restart/re-read; default is INFO |

See `journey-observability-sweep.yaml` for the machine-readable schema,
`journey-observability-sweep.feature` for Gherkin, and `shared-artifacts-registry.md`
for the `${variable}` source-of-truth table.
