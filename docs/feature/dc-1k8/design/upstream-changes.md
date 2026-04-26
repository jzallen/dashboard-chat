# Upstream Changes — dc-1k8 (DESIGN → DISCUSS)

## Change 1 — AC1.1 regex loosened to admit `unknown` graceful-degradation token

**Original** (from `discuss/user-stories.md`, AC1.1):

> Then within the first 50 lines of `docker compose logs <service>` exactly one line matches the regex
> `^[A-Za-z0-9_-]+ image=\S+ sha=[0-9a-f]{7,40}(?:\+dirty)? built=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`

**New**:

> The matching regex is
> `^[A-Za-z0-9_-]+ image=\S+ sha=(?:[0-9a-f]{7,40}|unknown)(?:\+dirty)? built=(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|unknown)$`

**Rationale**: AC1.5 (graceful degradation when build-stamp is absent) requires the service to still emit a single canonical line. The original regex rejected the `unknown` literal token, putting AC1.1 and AC1.5 in conflict. The DESIGN-locked format (§7 of `design.md`) keeps the line shape stable across the two cases by substituting `unknown` literally where a SHA or RFC3339 timestamp would normally appear.

**Impact on AC1.4 (stale-vs-fresh diagnosis)**: unchanged. `unknown` will never equal `git rev-parse --short=7 HEAD`, so AC1.4's "differs from HEAD" branch behaves correctly.

**Impact on tests**: the DISTILL acceptance test must use the loosened regex. The test for AC1.5 specifically asserts the `unknown` branch by booting an instrumented image with the version-layer tar removed (or a deliberately corrupt JSON injected).

This change is recorded here so DISTILL has a single source for the canonical regex.
