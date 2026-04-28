# Design — dc-1k8: App servers log image identity on startup

> **Status**: proposed (mode = `propose`; awaiting user decision between Options A/B/C)
> **Source**: `docs/feature/log-image-identity-on-startup/discuss/{user-stories,outcome-kpis,wave-decisions}.md`
> **Scope (D0)**: Application — affects build instrumentation + four service entrypoints
> **Mode (D1)**: Propose
> **Skipped (per user direction)**: C4 diagrams, domain modeling, SSOT `brief.md` bootstrap

---

## 1. Problem framing

DISCUSS established three stories and five+ acceptance criteria. The architectural question is narrow: **how does build identity (git SHA, build timestamp, dirty marker) get from a Bazel build into a running container's stdout (and, for the frontend, also onto an HTTP endpoint), such that the values are baked at build time, the +dirty marker is honest, and a missing-instrumentation image still boots?**

This is build-system instrumentation, not new domain logic. No new components. Every change is additive: one Bazel utility, one templated file per image, one logger per service entrypoint, one shim for the frontend container.

## 2. Constraints (carried from DISCUSS)

| # | Constraint | Source |
|---|------------|--------|
| C1 | Identity is fixed at BUILD time, not container-start time | AC1.2 |
| C2 | `+dirty` marker iff `git status --porcelain` non-empty at build time | AC1.3 |
| C3 | Frontend identity must be observable via stdout AND HTTP | Story 2 |
| C4 | Missing env vars / instrumentation must not crash the service | AC1.5 |
| C5 | Single shared format across services | AC3.1 |
| C6 | Touch surface limited to Bazel build + four service entrypoints | wave-decisions D5 |
| C7 | Cache hygiene — stamping must not invalidate the entire image cache on every build | implied by daily-iteration DX |

## 3. Existing-codebase landscape (Reuse Analysis)

Before designing anything new, surveying overlap with existing infrastructure:

| Existing component | File | Overlap with this feature | Decision | Justification |
|---|---|---|---|---|
| `oci_image` rules | `backend/BUILD.bazel:385`, `auth-proxy/BUILD.bazel:52`, `agent/BUILD.bazel:67`, `frontend/BUILD.bazel:331` | All four services already package via `oci_image` with `tars`, `entrypoint`, `exposed_ports`. We need to extend, not replace. | EXTEND | Add a stamped `version_layer` to `tars` and (optionally) `labels` to each existing rule. ~3 lines per rule. |
| `aspect_bazel_lib` (already in MODULE.bazel) | `MODULE.bazel` | Provides `expand_template` with `stamp_substitutions` for templating files using workspace-status keys | EXTEND | Use as-is; no new Bazel deps. |
| `rules_oci 2.2.7` (already in MODULE.bazel) | `MODULE.bazel` | Supports `oci_image.labels` and `oci_image.tars` from generated files | EXTEND | Same as above. |
| Backend FastAPI startup (`backend/app/main.py`) | `backend/app/main.py` | Has FastAPI lifespan / `__main__` boot point where a single log line slot in cleanly | EXTEND | Add ~5 LOC. |
| auth-proxy / agent entrypoints (`auth-proxy/index.ts`, `agent/index.ts`) | `auth-proxy/index.ts`, `agent/index.ts` | Top-level boot file for each Hono server | EXTEND | Add ~5 LOC each. |
| Frontend container entrypoint | `frontend/BUILD.bazel:332` (uses `@nginx_alpine` base, no shim today) | nginx is invoked directly; no app-level startup hook exists yet | CREATE NEW (small) | Add a shell entrypoint shim (~10 LOC) that prints identity, writes `_meta.json` into nginx's html dir, then `exec`s nginx. Existing `nginx_conf_layer` is the natural place to add it. |
| `tools/workspace_status.sh` | (does not exist) | No current workspace status command in the repo | CREATE NEW | Required for stamping; ~10 LOC; one-time addition. |

**No `CREATE NEW` decision creates a class or component that overlaps an existing one.** Both new artifacts (`workspace_status.sh`, frontend entrypoint shim) fill genuine gaps.

## 4. The three options

All three options share the **stamp source**: a new `tools/workspace_status.sh` that emits

```
STABLE_GIT_COMMIT a1b2c3d4...
STABLE_GIT_DIRTY 1                  # or "0"
STABLE_BUILD_TIMESTAMP 2026-04-26T19:40:12Z
```

…activated globally via `build --workspace_status_command=tools/workspace_status.sh` in `.bazelrc`. Using `STABLE_*` keys (not volatile `BUILD_*`) keeps the cache warm — only the small stamped layer rebuilds, not every dependent action.

The options differ in **how the values reach the running container** and **how each service reads them at startup**.

---

### Option A — Stamp → `oci_image.env`

Each `oci_image` declares:

```python
oci_image(
    name = "image",
    base = "@python_3_11_slim",
    tars = py_image_layer(...),
    entrypoint = ["/backend/server"],
    env = {
        "BUILD_GIT_SHA": "{{STABLE_GIT_COMMIT}}",
        "BUILD_GIT_DIRTY": "{{STABLE_GIT_DIRTY}}",
        "BUILD_TIMESTAMP": "{{STABLE_BUILD_TIMESTAMP}}",
        "BUILD_IMAGE_TAG": "dashboard-chat/api:bazel",
    },
    ...
)
```

Each service reads `os.environ` (Python) / `process.env` (Node) at startup and emits the identity line.

**Pros**:
- Minimal Bazel surface: ~4 lines per `oci_image` rule.
- No file reads at runtime; environment lookup is the cheapest possible.
- OCI-standard labels can be added with the same syntax, giving `docker inspect` a record.

**Cons**:
- **Stamp expansion in `env` strings is not guaranteed.** `rules_oci 2.x` does not auto-expand stamp keys inside the `env` dict; this requires either a wrapper rule that pre-expands the env values or a forked `oci_image` macro. Verifying support is a SPIKE.
- The env vars exist on **every process** in the image (not just the entrypoint) — a small but real namespace pollution, and `BUILD_*` clashes with some CI tooling.
- Frontend nginx does not naturally read env — Story 2's "stdout AND HTTP" requirement still needs a shim, so the env-based approach doesn't actually simplify the frontend.

---

### Option B — Stamp → templated `version.json` layer (RECOMMENDED)

`aspect_bazel_lib`'s `expand_template` rule produces a single file:

```python
expand_template(
    name = "version_json",
    out = "version.json",
    template = ["{",
                "  \"image\": \"{IMAGE}\",",
                "  \"sha\": \"{SHA}\",",
                "  \"dirty\": {DIRTY},",
                "  \"built\": \"{BUILT}\"",
                "}"],
    substitutions = {"{IMAGE}": "dashboard-chat/api:bazel"},
    stamp_substitutions = {
        "{SHA}":   "{{STABLE_GIT_COMMIT}}",
        "{DIRTY}": "{{STABLE_GIT_DIRTY}}",
        "{BUILT}": "{{STABLE_BUILD_TIMESTAMP}}",
    },
)
```

Wrapped as a `pkg_tar` mounting `version.json` at `/etc/dashboard-chat/version.json`, then added to each `oci_image.tars` list. Each service reads `/etc/dashboard-chat/version.json` once at startup and logs the identity. The frontend container's entrypoint shim additionally `cp`s the same file to `/usr/share/nginx/html/_meta.json` so it is HTTP-readable at `/_meta.json`.

A factored Bazel macro at `tools/version_layer.bzl` lets each service call `version_layer(name = "version", image = "dashboard-chat/api:bazel")` once.

**Pros**:
- Stamp support via `expand_template.stamp_substitutions` is the documented, supported path in `aspect_bazel_lib`. No SPIKE needed.
- Shared format is enforced by a single template — Story 3 (cross-service consistency) is structural, not aspirational.
- Frontend HTTP requirement (Story 2 / AC2.2) is one `cp` in the entrypoint shim — no extra build logic.
- File-based identity survives any future runtime-env shenanigans (e.g. if a service strips its environment).
- Clean separation: build system writes the file; runtime reads it. No coupling between `oci_image.env` semantics and language-specific env handling.

**Cons**:
- One more file to template (vs. four env vars). Marginal.
- Each language needs ~5 LOC to JSON-load and log (vs. environ lookup). Marginal.

---

### Option C — OCI labels only (no startup log)

Set `oci_image.labels` (from `expand_template` output) with the OCI-spec keys:

```
org.opencontainers.image.revision = <STABLE_GIT_COMMIT>
org.opencontainers.image.created  = <STABLE_BUILD_TIMESTAMP>
```

Identity is recovered via `docker inspect <container> --format '{{.Config.Labels}}'`.

**Pros**:
- Zero code change in any service.
- Standardized; tooling-friendly (Trivy, Syft, registries surface these).

**Cons**:
- **Violates AC1.1, AC1.4, AC2.1.** The whole user need is "I want this in `docker compose logs`, not in `docker inspect`." Replacing one inspect-based workflow with another inspect-based workflow does not move the K1 KPI.
- Frontend's HTTP requirement (Story 2 / AC2.2) is wholly unmet.

---

## 5. Recommendation: Option B

Rationale, ranked:

1. **Honest support story.** `expand_template.stamp_substitutions` from `aspect_bazel_lib` is documented and stable; `oci_image.env` stamp expansion is not. We avoid a SPIKE and a possible fork.
2. **Single source of truth across services.** One template, one shape, one parser per language. Story 3 (`AC3.1`: identical `sha=` and `built=` across all four services) becomes a structural property of the build, not an inspection.
3. **Frontend story falls out for free.** The same file the server processes read also gets `cp`'d into nginx's html dir — `/_meta.json` is one line of shell.
4. **Cache hygiene.** `STABLE_*` stamp keys do not invalidate dependent actions; only the version layer rebuilds. K3 (zero startup regressions) is protected; the change cost per developer iteration is essentially zero.
5. **Adoptable to OCI labels later if we want them.** The same template can populate `oci_image.labels` for `docker inspect` users — additive to Option B, not a competing path. Worth doing in the same PR for `org.opencontainers.image.{revision,created,source}`.

We propose Option B as the chosen path. Option A is a fallback if `expand_template`'s stamp behavior turns out to be insufficient. Option C is rejected on AC grounds.

## 6. Component impact (under Option B)

| Layer | File(s) | Change |
|---|---|---|
| Build infra | `tools/workspace_status.sh` (NEW) | Emit `STABLE_GIT_COMMIT`, `STABLE_GIT_DIRTY`, `STABLE_BUILD_TIMESTAMP`. ~10 LOC. |
| Build infra | `.bazelrc` | Add `build --workspace_status_command=tools/workspace_status.sh`. 1 line. |
| Build infra | `tools/version_layer.bzl` (NEW) | Macro: `version_layer(name, image_tag)` → expands `version.json` template + wraps as `pkg_tar` mounted at `/etc/dashboard-chat/version.json`. Reused by all four services. ~30 LOC. |
| Backend | `backend/BUILD.bazel:385` | Add `version_layer` call; reference its tar in `oci_image.tars`. 2 lines. |
| Backend | `backend/app/main.py` | Add `log_image_identity()` call at startup (FastAPI lifespan or `__main__`). ~10 LOC. |
| Auth-proxy | `auth-proxy/BUILD.bazel:52` | Same `oci_image.tars` addition. 2 lines. |
| Auth-proxy | `auth-proxy/index.ts` | Top-of-file identity log. ~8 LOC. |
| Agent | `agent/BUILD.bazel:67` | Same `oci_image.tars` addition. 2 lines. |
| Agent | `agent/index.ts` | Top-of-file identity log. ~8 LOC. |
| Frontend | `frontend/BUILD.bazel:331` | Add `version_layer` to `oci_image.tars`. Add new layer for entrypoint shim. ~5 lines. |
| Frontend | `frontend/docker-entrypoint.sh` (NEW) | Read `/etc/dashboard-chat/version.json`, echo identity line, `cp` to `/usr/share/nginx/html/_meta.json`, exec nginx. ~12 LOC. |
| Frontend | `frontend/BUILD.bazel:331` | Override `oci_image.entrypoint` to point at the shim. 1 line. |

**Total estimated change**: one new Bazel file, two new shell scripts, four BUILD edits, three entrypoint edits. Well within the "one slice, ≤1 day" envelope from DISCUSS.

## 7. Identity format (canonical, locked here)

Stdout line (matches AC1.1 regex):

```
<service-name> image=<tag> sha=<sha7>[+dirty] built=<rfc3339>
```

JSON file (`/etc/dashboard-chat/version.json` and frontend's `/_meta.json`):

```json
{
  "image": "dashboard-chat/api:bazel",
  "sha": "7ec9fa5",
  "dirty": false,
  "built": "2026-04-26T19:40:12Z"
}
```

A small implementation note: the SHA in the stdout line is the 7-char abbreviation (matches `git rev-parse --short=7 HEAD` from AC1.4); the JSON keeps the full 40-char SHA so machine consumers can do exact matches.

## 8. Graceful-degradation contract (AC1.5)

If `/etc/dashboard-chat/version.json` is **missing** OR **unparseable**, each service:

- logs `<service-name> image=unknown sha=unknown built=unknown` (single-line, same regex shape with literal `unknown` tokens — the AC1.1 regex uses `\S+` and the test is updated to permit literal `unknown` as a valid SHA token by extending the alphabet match)
- continues startup normally (no exception bubbles up)

The startup loader is wrapped in a try/except (Python) / try/catch (TypeScript) at the call site. The frontend shim falls back to a hardcoded `unknown` JSON if the cp source is missing.

## 9. Open questions for the user

1. **Identity log line format finalization.** The DISCUSS regex in AC1.1 is a draft. Is the form `<service> image=<tag> sha=<sha>[+dirty] built=<rfc3339>` acceptable? Alternatives: pure JSON (one-line), key=value pairs ordered differently, or a structured logger format. **Default if no answer**: the form above (locked in §7).
2. **Frontend HTTP path.** `/_meta.json` (chosen) vs. `/healthz` (existing convention?) vs. a meta tag in `index.html`. **Default**: `/_meta.json` because it is observable via `curl` without rendering the SPA, which is the developer use case.
3. **Should we also populate OCI labels (`org.opencontainers.image.revision`, etc.) in the same PR?** Cheap (one `expand_template` reuse) and useful for image registries / SBOM tooling. **Default**: yes, additive.
4. **Identity in `api-full` (compose's build-from-source variant)?** Out of scope per DISCUSS unless `api-full` resolves to the same Bazel target. **Default**: out of scope; revisit if `api-full` users complain.

If you do not weigh in on these, I'll proceed with the listed defaults at DISTILL/DELIVER time and note the choices in the DESIGN wave-decisions doc.

## 10. ADR-style summary (the one decision)

| Field | Value |
|---|---|
| **Status** | Proposed |
| **Context** | Developers cannot tell from `docker compose logs` whether containers are running freshly-rebuilt images. Docker-inspect-based workarounds cost time and break flow during local iteration. |
| **Decision** | Inject build identity (git SHA, dirty flag, build timestamp) at Bazel build time via `aspect_bazel_lib`'s `expand_template` with `stamp_substitutions`, package as a single `version.json` layer mounted at `/etc/dashboard-chat/version.json` in every bazel-built `oci_image`, and emit a single canonical identity line on each service's startup. The frontend container additionally publishes the file at `/_meta.json` via an entrypoint shim. (Option B.) |
| **Alternatives considered** | (A) `oci_image.env` with stamp-substituted strings — rejected on tooling-support uncertainty and frontend-doesn't-fall-out-cleanly. (C) OCI labels only — rejected on AC violation (the whole point is `docker compose logs`, not `docker inspect`). |
| **Consequences** | Adds `tools/workspace_status.sh`, `tools/version_layer.bzl`, and a frontend entrypoint shim. Four `BUILD.bazel` files gain one macro call each. Three service entrypoints gain a small startup logger. Cache impact: only the version layer rebuilds per commit; dependent actions stay cached because `STABLE_*` keys are excluded from action invalidation. |
| **Out of scope** | Production telemetry, end-user UI exposure, non-bazel-built compose services (db, query-engine, minio, mirth). |
