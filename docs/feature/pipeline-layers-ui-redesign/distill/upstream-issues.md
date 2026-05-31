# DISTILL Upstream Issues — pipeline-layers-ui-redesign / MR-1

Gaps/contradictions in prior-wave inputs surfaced while writing MR-1 acceptance tests.

## UI-1 — SSR ingress currently blocked (affects the true port-to-port WS)
**Finding:** The no-flash guarantee is most truthfully verified by fetching
server-rendered HTML through the reverse-proxy/web-ssr ingress. Per session notes
(`resume-ssr-build-and-demo`), there is an active **SSR asset-hash 404 blocker**,
so that ingress cannot be relied on to serve cleanly right now.
**Resolution (reconciled with user):** gate the MR-1 walking skeleton in vitest
(`theme.test.tsx` AC1) and author the HTTP-ingress check as a deferred, skipped
adapter-integration suite (`tests/acceptance/pipeline-ui-design-tokens/`). Un-skip
once SSR serves cleanly. No contradiction with path-forward — just a medium choice
forced by current infra state.

## UI-2 — No DISCUSS artifacts for this feature (graceful degradation applied)
**Finding:** `docs/feature/pipeline-layers-ui-redesign/` has `path-forward.md`
(DESIGN-equivalent) + `design-sources.md`, but no `discuss/` (user stories, AC,
journeys). No `docs/product/journeys/*` covers this redesign.
**Resolution:** Per the DISTILL graceful-degradation rule, acceptance criteria
were **derived from the DESIGN artifact** (path-forward §5/§9) and story↔scenario
traceability was skipped. Not blocking. If MR-2+ grows, consider a light
`/nw-discuss` pass to capture the redesign's user stories/journey for traceability.

## UI-3 — `brief.md` lacks a "For Acceptance Designer" driving-ports section
**Finding:** `docs/product/architecture/brief.md` exists but has no explicit
driving-port handoff section.
**Resolution:** Driving ports derived from path-forward §4.3 + repo precedent
(`frontend/app/root.test.tsx`, `tests/acceptance/frontend-coexistence/`). Non-blocking.
