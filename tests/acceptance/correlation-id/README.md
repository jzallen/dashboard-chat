# Acceptance — correlation-id (US-1)

Cross-service correlation-id assertion (K1) for **US-1 — Trace one request
end-to-end**. One request traverses the auth-proxy ingress and the backend, and
the operator follows it by a single `correlation_id`: every log line that
request produced carries the same id, and the error response carries it too.

## What it asserts

| Test | Covers | Kind |
|---|---|---|
| `test_request_across_auth_proxy_and_backend_shares_one_correlation_id` | AC1.4 / Slice AC2 — all log lines for a request share one `correlation_id` | `@real_io` walking skeleton |
| `test_error_response_carries_correlation_id` | AC1.3 / Slice AC3 — the error response carries the `correlation_id` | `@real_io` error path |
| `test_python_correlation_seam_binds_and_reads_back` | the Python `correlation_id` `ContextVar` seam binds/reads | `@scaffold` (stack-independent RED) |
| `test_node_correlation_store_module_is_present` | the Node `AsyncLocalStorage` seam exists to import | `@scaffold` structural guard |

## Walking-skeleton strategy

Real local services (`auth-proxy` → `backend` over the compose network), real
emitted log lines read back via `docker compose logs`. The only faked dependency
is the costly LLM external — no chat turn is driven. The `@real_io` scenarios
skip cleanly when the stack is not reachable; the `@scaffold` scenarios keep the
suite classifying **RED** (assertion failure, never `ImportError`) in any
environment.

## Run it

```bash
# From inside the suite (own pyproject + venv; --no-project skips the workspace
# uv would otherwise infer from cwd):
cd tests/acceptance/correlation-id && uv run --no-project pytest

# The @real_io cross-service path additionally needs the compose stack up:
docker compose up -d            # from repo root — auth-proxy (1042) + api + db + redis
```

Until the implementation sub-issues land, the suite is RED: the scaffold seams
raise `AssertionError` and, with the stack up, neither service stamps
`attributes.correlation_id` nor echoes it on the error response.
