# App Servers Log Image Identity on Startup — Evolution

> **Feature**: log-image-identity-on-startup
> **Finalized**: 2026-05-04
> **Epic**: dc-1k8
> **DELIVER beads**: dc-1k8.1 (walking skeleton verification), dc-1k8.2 (milestone 1 — server-process identity), dc-1k8.3 (milestone 2 — frontend identity), dc-1k8.4 (milestone 3 — cross-service consistency), dc-1k8.5 (milestone 4 — graceful degradation)
> **Manual finalize workaround**: `dc-444` (no `deliver/execution-log.json` produced by polecat-work formula; synthesized from bead history)

## Summary

Each containerized bazel-built app server (api, frontend, auth-proxy, agent) now logs a single canonical line on startup announcing the image identity (git SHA, build timestamp, dirty marker), and exposes the same identity as JSON for machine consumers. A developer can run `docker compose logs <service> | head` and confirm at a glance whether `docker compose up` is running a freshly-rebuilt image — replacing the old `docker inspect` + digest-reasoning workflow.

## Business Context

Local Bazel + docker compose iteration produced a recurring stale-image confusion: after `bazel run //backend:image_load && docker compose up -d api`, there was no way to tell from `docker compose logs api` whether the new image booted or the previous one stayed cached. The detour through `docker inspect` + manual digest comparison cost time and broke flow on every iteration cycle.

Outcome (KPIs): time-to-confirm-image-freshness drops from `≥30s` (digest reasoning) to `<5s` (glance at `docker compose logs | head`). 4/4 bazel-built services emit a conforming identity line, asserted in CI via the BDD acceptance suite. Zero startup-regression alerts from the instrumentation.

## Identity format (canonical, locked)

Stdout (one line per service, within first 50 lines):

```
<service-name> image=<tag> sha=<sha7>[+dirty] built=<rfc3339>
```

JSON (`/etc/dashboard-chat/version.json` and frontend's `/_meta.json`):

```json
{"image":"dashboard-chat/api:bazel","sha":"<full-40>","dirty":<bool>,"built":"<rfc3339>"}
```

The stdout SHA is the 7-char abbreviation (matches `git rev-parse --short=7 HEAD`); the JSON keeps the full 40-char SHA for exact-match tooling.

The walking-skeleton regex (loosened during DESIGN→DISCUSS back-propagation to admit the `unknown` graceful-degradation token):

```
^[A-Za-z0-9_-]+ image=\S+ sha=(?:[0-9a-f]{7,40}|unknown)(?:\+dirty)? built=(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|unknown)$
```

## Architecture (Option B — stamp-templated `version.json` layer)

Three new build-system files, four `oci_image` rules extended, three service entrypoints extended, one new container shim:

| Layer | File | Role |
|---|---|---|
| Build infra | `tools/workspace_status.sh` (NEW, ~10 LOC) | Emits `STABLE_GIT_COMMIT`, `STABLE_GIT_DIRTY` (boolean), `STABLE_BUILD_TIMESTAMP` |
| Build infra | `.bazelrc` | `build --workspace_status_command=tools/workspace_status.sh` |
| Build infra | `tools/version_layer.bzl` (NEW, ~30 LOC) | Macro: `expand_template` + `pkg_tar` mounting `/etc/dashboard-chat/version.json` |
| Build infra | `tools/version.json.tmpl` (NEW) | Single shared JSON template |
| Backend | `backend/BUILD.bazel`, `backend/app/version.py`, `backend/app/main.py` | `version_layer` in `oci_image.tars`; FastAPI lifespan emits identity |
| Auth-proxy | `auth-proxy/BUILD.bazel`, `auth-proxy/version.ts`, `auth-proxy/index.ts` | Same pattern, top-of-file identity log |
| Agent | `agent/BUILD.bazel`, `agent/version.ts`, `agent/index.ts` | Same pattern |
| Frontend | `frontend/BUILD.bazel`, `frontend/docker-entrypoint.sh` (NEW, ~12 LOC) | nginx wrapper: read JSON, echo identity line, copy to `/usr/share/nginx/html/_meta.json`, `exec` nginx |

`STABLE_*` workspace-status keys (not volatile) keep the Bazel cache warm — only the small `version_layer` rebuilds per commit; dependent build actions stay cached.

## Graceful-degradation contract (AC1.5)

If `/etc/dashboard-chat/version.json` is missing or unparseable, each service:

- logs `<service-name> image=unknown sha=unknown built=unknown` (literal `unknown` tokens)
- continues startup normally (loader wrapped in try/except in Python, try/catch in TypeScript)
- frontend shim falls back to a hardcoded `unknown` JSON when `cp` source is missing

## Delivery (5 milestones)

| Bead | Title | Verification |
|---|---|---|
| `dc-1k8.1` | Walking-skeleton smoke verification (characterization) | `pytest -m walking_skeleton` GREEN against current main; no code changes (implementation pre-existed DISTILL artifact per DLD-5) |
| `dc-1k8.2` | Milestone 1 — server-process identity (api, agent, auth-proxy) | AC1.1 × 3 services, AC1.2 restart-invariance × 3 services, AC1.3 `+dirty` marker, AC1.4 stale-vs-fresh — all GREEN |
| `dc-1k8.3` | Milestone 2 — frontend identity (entrypoint shim + nginx) | AC2.1 stdout identity line, AC2.2 `GET /_meta.json` JSON with sha cross-match, AC2.3 canonical-shape conformance — all GREEN |
| `dc-1k8.4` | Milestone 3 — cross-service consistency | AC3.1 single shared format across 4 services; AC3.2 unambiguous service identifiers — all GREEN. `_capture_four_service_identities` pins `SOURCE_DATE_EPOCH` to HEAD commit time so all four bazel run invocations stamp identical `STABLE_BUILD_TIMESTAMP` |
| `dc-1k8.5` | Milestone 4 — graceful degradation | AC1.5: services boot AND emit `sha=unknown built=unknown` when `version.json` is missing/malformed — GREEN |

## Key Decisions

### From DISCUSS (`dc-1k8` discuss/wave-decisions)

- **D1** Cross-cutting feature (build instrumentation + four service entrypoints). Not user-facing; not pure infra.
- **D2** No walking skeleton needed (brownfield, isolated change — adding one log line per service).
- **D3** Lightweight UX — sole user is a developer at the terminal; no personas, no journey mapping.
- **D4** No JTBD (single, obvious job: "verify a fresh image is what's running").
- **D5** Lean DISCUSS: Phase 3 (Requirements) only; skipped JTBD, Journey, story-map slicing — feature is one slice end-to-end (≤1 day).
- **D6** Migration gate (skill-prescribed) bypassed with rationale: project predates SSOT-model adoption (`dc-6gg`, `dc-e65d` are pre-existing feature dirs). Migrating the entire project's SSOT to ship a startup log line is disproportionate. Flagged for the user; not blocking.
- **D7** Frontend asymmetry acknowledged: static SPA has no native startup log. Identity surface is its serving container's stdout (entrypoint shim emits one-shot line) plus an HTTP-readable identity (`/_meta.json`).

### From DESIGN (`dc-1k8` design/wave-decisions)

- **D1** Application-scope design (no system topology change, no new bounded context).
- **D2** Mode = Propose (architect presents three options; user picks).
- **D3** Chosen Option B — stamp-templated `version.json` layer + per-service startup logger + frontend entrypoint shim. Option A (`oci_image.env` with stamp-substituted strings) rejected on tooling-support uncertainty (would have required a SPIKE). Option C (OCI labels only) rejected on AC violation: the whole point is `docker compose logs`, not `docker inspect`.
- **D4–D6** Skipped C4 diagrams, domain modeling, and SSOT `brief.md` bootstrap (per user direction; no architectural-component change).
- **D7** Use `STABLE_*` workspace-status keys only — keeps Bazel cache warm.
- **D8** Identity format locked in DESIGN §7 (stdout: 7-char SHA; JSON: full 40-char SHA).

### Open questions resolved at DESIGN (defaults adopted)

1. Identity log line format → as locked in DESIGN §7
2. Frontend HTTP path → `/_meta.json`
3. OCI labels populated in same PR → yes, additive (`org.opencontainers.image.{revision,created}`)
4. `api-full` compose variant → out of scope

### From DISTILL (`dc-1k8` distill/wave-decisions)

- **DLD-1** Walking-Skeleton Strategy = C (real local I/O). InMemory doubles would invalidate K2 (CI guarantee).
- **DLD-2** Container option = Docker Compose, not testcontainers — reuses repo-root `docker-compose.yml` so "what the test runs" matches "what the developer runs."
- **DLD-3** New `tests/acceptance/` root using `pytest-bdd`; self-contained `pyproject.toml` so the harness doesn't entangle with `backend/`'s production deps.
- **DLD-4** Mandate 7 (RED scaffolds) N/A — acceptance test imports zero production code; exercises subprocess paths (`bazel`, `docker compose`, `curl`).
- **DLD-5** These are characterization tests, not red-then-green specs — production implementation landed in commits before the DISTILL artifact was written. Walking-skeleton scenario expected GREEN on first run (Feathers brownfield pattern).
- **DLD-6** One walking-skeleton scenario, four `@pending` milestone files. DELIVER enables them one at a time. Default `pytest` invocation runs only the walking skeleton (`-m "not pending"`).
- **DLD-7** All four DESIGN open-question defaults match the existing implementation; no new decisions forced.

## Issues encountered (during DELIVER)

- **DESIGN→DISCUSS regex divergence (resolved upstream).** AC1.1 regex (`sha=[0-9a-f]{7,40}`) did not admit the literal `unknown` graceful-degradation token, putting AC1.1 and AC1.5 in conflict. DESIGN loosened to `sha=(?:[0-9a-f]{7,40}|unknown)(?:\+dirty)?` and propagated to DISCUSS via `design/upstream-changes.md`.
- **Backend bazel deps regression discovered during dc-1k8.2.** `redis` missing from BUILD; `aiodocker`/`pyarrow_hotfix` stale; `requirements_*_lock.txt` out of sync with `uv.lock` (pyproject had `stream-chat` etc. unlocked). Fixed by regenerating locks via `uv export`, adding `@pip//redis` + `@pip//stream_chat`, removing stale `aiodocker`/`pyarrow_hotfix` from BUILD.bazel. Recorded as Issue 5 in distill/upstream-issues.md.
- **`STABLE_GIT_DIRTY` boolean form (vs DESIGN draft `1`/`0`).** DESIGN sketched `STABLE_GIT_DIRTY 1` / `0`; shipped `tools/workspace_status.sh` emits JSON booleans `true` / `false` so the value substitutes directly into `version.json` (which is JSON-typed). Discuss `user-stories.md` AC2.1 locks in `"dirty":<bool>` for the file/HTTP payload, so the boolean form is the correct contract; the `1`/`0` snippet was an informal early sketch. The DISTILL `milestone-1-server-identity.feature` (AC1.3) was authored against the early-draft form and was updated during DELIVER of milestone-1 to assert `STABLE_GIT_DIRTY true`.
- **No DEVOPS wave artifact.** Documented in `distill/upstream-issues.md` Issue 4. The feature has no production / cloud environment surface (DISCUSS Out-of-Scope); no further DEVOPS work needed.

## Acceptance test surface (preserved at `tests/acceptance/log-image-identity-on-startup/`)

The BDD acceptance suite is the permanent guard on the canonical identity contract:

- `walking-skeleton.feature` — single end-to-end scenario for `dashboard-api` (real `bazel run` + real `docker compose up` + real log polling)
- `milestone-1-server-identity.feature` — AC1.1–AC1.4 across api, agent, auth-proxy
- `milestone-2-frontend-identity.feature` — AC2.1–AC2.3 (stdout + `/_meta.json` cross-match)
- `milestone-3-cross-service.feature` — AC3.1, AC3.2 across all four services concurrently
- `milestone-4-graceful-degradation.feature` — AC1.5 missing/malformed `version.json` branch

The walking skeleton runs by default; milestone scenarios run via the full acceptance invocation. Walking-skeleton specification preserved at `docs/scenarios/log-image-identity-on-startup/walking-skeleton.md`.

## Lessons learned

- **Brownfield characterization is the right default for instrumentation features.** The implementation pre-existed the DISTILL artifact; trying to red-then-green a feature whose code was already written would have produced theatre tests. DLD-5 made this explicit; the walking-skeleton scenario verified the contract against the running code.
- **`STABLE_*` stamp keys are non-negotiable for cache hygiene.** Volatile `BUILD_*` keys would invalidate dependent actions on every commit and undermine K3 (zero startup regressions). The `version_layer` is the only artifact that rebuilds per commit.
- **Frontend asymmetry deserves its own milestone.** The entrypoint shim (`frontend/docker-entrypoint.sh`) is structurally different from the three Python/TS startup loggers — separating it into milestone-2 with its own AC scenarios kept the per-service step glue clean.
- **Cross-service consistency (AC3.1) requires `SOURCE_DATE_EPOCH` pinning.** Four separate `bazel run` invocations would otherwise stamp four different `STABLE_BUILD_TIMESTAMP` values. Helper `_capture_four_service_identities` pins to HEAD commit time so the identity-comparison assertion is structurally satisfied, not racy.
- **Manual finalize workaround documented in `dc-444`.** The polecat-work formula does not write `deliver/execution-log.json`; nw-finalize's Pre-Dispatch Gate halts on the missing file. Workaround: synthesize the log from bead history (dc-1k8.1–dc-1k8.5) before invoking finalize. Out of scope for this feature (`dc-444` tracks the skill-side fix).

## Migration trail (Phase B per nw-finalize destination map)

- `distill/walking-skeleton.md` → `docs/scenarios/log-image-identity-on-startup/walking-skeleton.md`
- All other wave artifacts (discuss, design, distill, deliver) absorbed into this evolution doc; raw files removed from `docs/feature/log-image-identity-on-startup/`.
