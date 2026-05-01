# Upstream Issues from DISTILL — dc-1k8

This file logs gaps DISTILL discovered in prior-wave artifacts. It is
the "back-propagation" surface mandated by the DISTILL skill —
findings here should round-trip to DISCUSS / DESIGN before DELIVER
proceeds against ambiguous specs.

## Issue 1 — DESIGN→DISCUSS regex divergence (already resolved)

**Status:** Resolved upstream. Recorded here for traceability.

DESIGN §8 / `design/upstream-changes.md` already loosened the AC1.1
regex to admit literal `unknown` tokens so that AC1.5 (graceful
degradation) and AC1.1 (canonical line shape) are no longer in
conflict. DISTILL adopts the loosened regex without further change:

```
^[A-Za-z0-9_-]+ image=\S+ sha=(?:[0-9a-f]{7,40}|unknown)(?:\+dirty)? built=(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|unknown)$
```

## Issue 2 — Implementation pre-existed DISTILL artifact

**Status:** Acknowledged as brownfield characterization (see
`distill/wave-decisions.md` DLD-5).

The production code for this feature
(`backend/app/version.py`, `agent/version.ts`, `auth-proxy/version.ts`,
`frontend/docker-entrypoint.sh`, `tools/workspace_status.sh`,
`tools/version_layer.bzl`, `tools/version.json.tmpl`) landed before
the DISTILL acceptance test was written. Nothing in nWave's brownfield
guidance forbids this — characterization tests are explicitly the
right move for code that exists without specs (see
`docs/research/nwave-brownfield-approach.md`). The walking-skeleton
scenario is therefore expected GREEN on first run; if it goes RED,
that is a **specification ↔ implementation divergence** and must be
filed as Issue 3+ here before DELIVER touches anything.

## Issue 3 — DISCUSS Out-of-Scope row 2 vs DESIGN coverage of `api-full`

**Status:** Decision deferred to `wave-decisions.md` DLD-7 (default:
out of scope; revisit if `api-full` users complain).

DISCUSS Out-of-Scope row 2 says: "Identity for `api-full` (the build-
from-source variant in compose) — covered transitively if it builds
from the same Bazel target; otherwise out of scope." DESIGN §9
question 4 deferred the same question. The DISTILL feature files
intentionally do **not** include `api-full` scenarios; if a future
contributor wants them, they should add a new milestone-5 .feature
file rather than extending milestone-1 (different image, different
build path).

## Issue 5 — DESIGN draft `STABLE_GIT_DIRTY 1/0` vs shipped `true/false`

**Status:** Resolved during DELIVER milestone-1; .feature literal
updated to match implementation.

`design/design.md` §4 sketched the workspace-status emission as
`STABLE_GIT_DIRTY 1` / `0`. The shipped `tools/workspace_status.sh`
emits the JSON booleans `true` / `false` so that the value can be
substituted directly into `version.json` (which is JSON-typed:
`"dirty": <bool>`). The user stories (`discuss/user-stories.md`
AC2.1) lock in `"dirty":<bool>` for the HTTP/file payload, so the
boolean form is the correct contract; the design.md "1/0" snippet
was an informal early sketch.

The DISTILL `milestone-1-server-identity.feature` (AC1.3) was
authored against the early-draft form and was updated during DELIVER
of milestone-1 (dc-1k8.2) to assert `STABLE_GIT_DIRTY true`. No
production-code change.

## Issue 4 — No DEVOPS wave artifact

**Status:** Documented; no action required.

There is no `docs/feature/log-image-identity-on-startup/devops/`
directory. The DISTILL skill's graceful-degradation rule applies:
log a warning and use the default environment matrix. For dc-1k8
the matrix is implicit — there is one environment (the contributor's
laptop or CI runner with bazel + docker installed). The feature has
no production / cloud environment surface (DISCUSS Out-of-Scope row
3 expressly excludes prod/cloud). No further DEVOPS work is needed
at the DISTILL boundary; if/when prod observability becomes in
scope, that is a new feature, not an extension of this one.
