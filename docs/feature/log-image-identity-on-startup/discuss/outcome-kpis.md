# Outcome KPIs — dc-1k8

| # | KPI | Baseline | Target | Measurement |
|---|-----|----------|--------|-------------|
| K1 | Time-to-confirm-image-freshness (developer terminal) | ≥30s — requires `docker inspect`, digest comparison, mental model | <5s — glance at first lines of `docker compose logs <service>` | Self-reported timed walkthrough by the requesting developer post-implementation; informal but sufficient for a DX feature. |
| K2 | Coverage of bazel-built services emitting a conforming identity line | 0/4 services | 4/4 services (api, frontend, auth-proxy, agent) | Automated check in CI: `docker compose up -d <service> && docker compose logs <service> \| grep -E 'image=.+ sha=.+ built='` returns exactly one match for each of the four services. The DISTILL acceptance test wires this in. |
| K3 | Startup-regression count attributable to the instrumentation | n/a (pre-feature) | 0 | Existing healthchecks / smoke tests remain green on the feature PR; no new alerts in the first week post-merge. |
| K4 | Dirty-build mis-identifications | n/a | 0 missed `+dirty` markers when `git status --porcelain` is non-empty at build time | Acceptance test invokes a build with a deliberate `echo > /tmp/touch && git add /tmp/touch && bazel run …` and asserts the `+dirty` token appears. |

## Notes on Measurement

- K1 is qualitative. We are not investing in a metrics pipeline for a DX line; "the user who asked for this confirms the workflow now feels instant" is the bar.
- K2 and K4 are enforced by the DISTILL acceptance test and run in CI on every PR — they are the durable guarantees.
- K3 is measured by absence (no new flakiness). If the smoke suite goes red on the feature branch, K3 fails and the branch does not merge.

## Why these and not others

We considered, then rejected:

- **"Time to detect a stale prod deployment"** — out of scope; this feature is local-dev only.
- **"Number of times the developer chooses to rebuild after seeing the SHA"** — vanity metric; rebuild rate could go either direction and still be a success.
- **"% of CI runs where image identity matches commit SHA"** — already a tautology in CI; CI builds are always fresh. Useful only locally where the staleness risk lives.
