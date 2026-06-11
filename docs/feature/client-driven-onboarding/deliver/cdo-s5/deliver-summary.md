# CDO-S5 DELIVER summary

## Step 05-06 — Compose env deltas (single-cut) + full acceptance integration gate

Layer: compose + integration verification (ADR-048 §4; ADR-049/050 topology unchanged).

The single-cut compose deltas removed the split-brain failure class from compose config
(ui-state zero-egress; auth-proxy as sole WORKOS holder with an explicit `WORKOS_BASE`
pin) and the change was verified by re-running the FULL org-onboarding acceptance suite
against a stack rebuilt from this worktree. No new unit test — the integration regression
IS the verification.

### Compose keys changed (`docker-compose.yml`)

| Service | Change | Keys |
|---|---|---|
| ui-state | REMOVED | `FAKE_WORKOS_URL`, `AUTH_MODE`, `BACKEND_URL` (`UI_STATE_BACKEND_URL`), `extra_hosts:` (`host.docker.internal:host-gateway`) |
| ui-state | KEPT | `PORT`, `REDIS_URL`, `FLOW_EVENT_MAXLEN`, `ENVIRONMENT`, `NWAVE_HARNESS_KNOBS`, ports |
| auth-proxy | ADDED | `WORKOS_BASE: ${WORKOS_BASE:-https://api.workos.com}` |
| api / api-full | VERIFIED clean (NO-OP) | no `AUTH_MODE`/`WORKOS_*` keys |
| agent | untouched (ADR-048 R3, out of scope) | — |
| docker-compose.override.yml | verify-only (NO-OP) | api has no AUTH_MODE pin; auth-proxy `AUTH_MODE: dev` left |

No topology / port / replica / persistence change.

### ui-state boots with env removed

`docker logs dashboard-ui-state` → `{"event":"flow.startup","port":8788}`. Single clean
startup, no restart loop, no config-validation crash. config.ts (Redis-only since 05-02)
parses the shrunken environment without throwing.

### Acceptance suite result (rebuilt stack, auth-proxy ingress :1042)

Command:
```
cd tests/acceptance/org-onboarding && \
  REVERSE_PROXY_URL=http://localhost:1042 AUTH_PROXY_URL=http://localhost:1042 \
  uv run --no-project --with 'httpx>=0.27,<1' --with 'pytest>=7,<9' \
  --with 'pytest-asyncio>=0.23,<1' pytest -p no:cacheprovider --no-header -q
```

Result: **13 passed, 1 failed (5.09s)** — the single failure is the documented,
carried-forward UPSTREAM-S3-1 RED.

| Test | Marker | Result |
|---|---|---|
| test_walking_skeleton_org_then_default_project | walking_skeleton / cdo_s1 | PASS |
| test_orgless_principal_routes_to_onboarding | cdo_s1 | PASS |
| test_org_absent_from_db_routes_to_onboarding | cdo_s1 | PASS |
| test_default_project_completes_onboarding | cdo_s1 | PASS |
| test_org_creation_persists_created_by | cdo_s1 | PASS |
| test_post_orgs_no_longer_auto_creates_project | cdo_s2 | PASS |
| test_invalid_org_name_stays_needs_org | cdo_s2 | PASS |
| test_unknown_event_type_rejected | cdo_s3 | PASS |
| test_late_event_converges_process_alive | cdo_s3 | PASS |
| test_org_create_failure_retryable | cdo_s3 | PASS |
| test_default_project_retry_convergence | cdo_s3 | PASS |
| test_mode_discovery | cdo_s4 | PASS |
| test_reissue_sets_cookie | cdo_s4 | PASS |
| **test_org_name_taken_reedit** (test_name_taken_stays_needs_org_then_recovers_with_a_new_name) | cdo_s3 | **RED (expected — UPSTREAM-S3-1)** |

### The one expected RED — UPSTREAM-S3-1

`test_org_name_taken_reedit.py` asserts the SSOT returns **409** on a duplicate org
name; the backend returns **500** (AuthorizationError → 500 upstream issue, compounded
by the DISTILL single-principal limitation). This is OUT of CDO-S5 scope; the Iron Rule
forbids editing the test, so it ships RED + documented, exactly as carried forward from
the CDO-S4 gate. The 500 (not a 4xx/connectivity error) confirms the stack is wired and
the failure is the known backend semantics, not an S5 regression.

### cdo_s5 marker

No python acceptance scenario (per pyproject.toml: "DELIVER-unit / fake-WorkOS coverage;
no new python acceptance scenario"). WorkOS interception is auth-proxy-unit-covered in
step 05-03.
</content>
</invoke>
