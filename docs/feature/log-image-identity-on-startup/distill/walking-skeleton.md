# Walking Skeleton — dc-1k8

The `.feature` file is the SSOT for this scenario; this note exists
to record the design rationale around its structure.

## Scenario in plain English

> Build a real bazel image for `dashboard-chat/api:bazel`. Start a
> real container via `docker compose up -d api`. Within the first 50
> lines of `docker compose logs api`, find exactly one line matching
> the canonical identity regex. Verify the captured short SHA equals
> the `STABLE_GIT_COMMIT` that `tools/workspace_status.sh` would
> produce for HEAD.

## Why one service, not all four, in the WS

Per DESIGN §6 the four services share one Bazel macro
(`tools/version_layer.bzl`) and one JSON template
(`tools/version.json.tmpl`). The mechanism is identical across
services; the only per-service variation is the language used to
read the JSON and emit the line. Proving the path works for one
service proves the structural property; the remaining three are
covered by milestone-1 and milestone-3 scenarios.

Choosing `dashboard-api` for the WS over the other three:

- **Python's `version.py` is the longest-lived implementation** and
  has the most accidental complexity (graceful-degradation try/except,
  short-vs-full SHA branching). If the WS catches the format, the
  TS variants — which are near-line-for-line ports — can be assumed
  conforming until proven otherwise.
- **The api container's startup is fastest** (FastAPI lifespan
  emits the line during app boot, well before health probes). Agent
  has heavier startup; auth-proxy is comparable but newer.
- **Frontend is structurally different** (entrypoint shim + nginx)
  and warrants its own dedicated milestone (milestone-2).

## Why the `@driving_adapter` tag

The DISTILL skill mandates at least one walking-skeleton scenario
that exercises the user's actual invocation path via subprocess /
HTTP. For dc-1k8 the user's invocation path is:

1. `bazel run //backend:image_tar` (the build/load adapter — `rules_oci`'s `oci_load` macro names the target `image_tar`)
2. `docker compose up -d api` (the runtime adapter)
3. `docker compose logs api | head` (the observability adapter)

The walking-skeleton scenario invokes all three via subprocess.
Pipeline-level tests that called `log_image_identity()` directly in-
process would prove the formatter works but not that:

- Bazel's `expand_template` actually populates `version.json` at
  build time;
- the `pkg_tar` layer actually mounts at `/etc/dashboard-chat/`;
- the entrypoint actually runs early enough for the line to land in
  the first 50 lines of stdout;
- `docker compose logs` actually prefixes/passes through the line
  (the bindings strip the `<service>  | ` prefix before regex matching).

These are exactly the seams that an in-process unit test misses, and
they are exactly what the user's K1 KPI ("time-to-confirm-rebuild
drops below 5s") relies on.

## Skip behavior when bazel/docker are absent

`conftest.py` provides a session-scoped `requires_real_io` fixture
that calls `pytest.skip()` if `bazel` or `docker` are not on
`$PATH`. Contributors on a laptop without the toolchain see a
skipped scenario (not a failure) and can still iterate on adjacent
work. CI always has the toolchain so the scenario always runs there.

## Expected outcome on first run

GREEN. The implementation landed in commits prior to this DISTILL
artifact (see DLD-5). If the scenario goes RED, the divergence
between the canonical regex and the running implementation is a
finding for `distill/upstream-issues.md`, not a "to be implemented"
gap.
