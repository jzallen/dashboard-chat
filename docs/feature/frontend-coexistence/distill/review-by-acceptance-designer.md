# Review by Acceptance Designer — frontend-coexistence DISTILL wave

**Reviewer:** nw-acceptance-designer-reviewer (Haiku, 2026-05-13)
**Wave:** DISTILL
**Verdict:** **PASS** (no blockers; ready for DELIVER handoff)

The DISTILL acceptance suite is well-structured, well-documented, and ready for DELIVER handoff. No blockers. Zero mandate violations.

---

## Assessment summary

### 1. Acceptance criteria quality — ✓

All 36 scenarios use clear business language focused on user outcomes ("Maya opens Dashboard Chat", "A request to the root path", "A loader-backed route responds with 5xx within 5 seconds"). Observable outcomes are named, not implementation steps. Assertions check HTTP status, Content-Type, HTML structure, file existence — not internal state. No technical jargon leaks into scenario titles or Given-When-Then text.

### 2. Driving-port discipline — ✓

- **Walking skeleton** (1 scenario): `reverse-proxy` HTTP ingress (host port 5173) — user's URL bar.
- **Routing parity** (5 scenarios in existing-routes-render-identically-through-ssr.feature): `reverse-proxy` HTTP ingress + filesystem inspection.
- **Topology** (2 scenarios in compose-topology-gains-one-service.feature): `docker compose config --services` subprocess.
- **Loader scenarios** (5 in loader-forwards-bearer-to-auth-proxy.feature + 5 in migrated-route-renders-html-server-side.feature): `reverse-proxy` HTTP ingress with Bearer token headers.
- **Chat-route scenarios** (5 in chat-route-bypasses-ssr-via-clientloader.feature): filesystem inspection + HTTP probe.
- **Praxis additions** (6 scenarios across 3 files): `reverse-proxy` HTTP ingress, `docker compose --scale` subprocess, HTTP wall-clock timing.

All driving ports are external-facing or environmental (HTTP, filesystem, docker compose) — zero internal component mocks.

### 3. Walking-skeleton integrity (Mandate 5) — ✓

File: `rrv7-handler-renders-existing-routes.feature`, 1 scenario.

- **User goal framing** ✓: "Maya opens Dashboard Chat after MR-0 ships and the app renders identically to pre-MR-0." Describes user value, not layer connectivity.
- **Observable outcomes** ✓: Response is 200, Content-Type is text/html, response body is well-formed HTML5 with `<div id="root">` + client script, no error page. All assertions check user-visible output.
- **Non-technical stakeholder test** ✓: A product person can read this and confirm "yes, that is what users need."
- **Comment clarity** ✓: The .feature file explicitly documents that this is NOT a layer-connectivity proof.

### 4. Adapter scenario coverage (Mandate 6) — ✓

- `reverse-proxy` (HTTP ingress): walking skeleton + 20+ scenarios across all .feature files.
- `docker compose`: 2 scenarios in compose-topology-gains-one-service.feature + scaling scenarios in ssr-instances-produce-identical-html.feature.
- `auth-proxy`: 5 bearer-forwarding scenarios + 2 loader-timeout scenarios + 2 fan-out scenarios.
- Filesystem (repo state inspection): 9 scenarios in existing-routes-render-identically-through-ssr.feature.

No adapter is untested.

### 5. Wave-decision reconciliation — ✓

- DI-1 (Strategy C): confirmed — `requires_compose_stack` probes `reverse-proxy:5173` and `pytest.skip()`s on timeout.
- DI-2 (pytest + httpx + subprocess, no pytest-bdd, Playwright deferred): confirmed — pyproject.toml declares only pytest, httpx, pyyaml; DOM-fingerprint scenario marked `@needs_playwright` with a fail message pointing to DI-2.
- DI-3 (4 slices): confirmed — roadmap.json phases 01–04 with explicit `scenarios_to_unskip` per slice.
- DI-4 (walking-skeleton shape): confirmed — scenario asserts shell pass-through, not data-fetching.
- DI-5 (Praxis additions as Slice 4): confirmed — three behavior-first .feature files tagged `@slice-4`.
- DI-6 (no new dependencies at DISTILL): confirmed.
- DI-7 (Mandate 7 N/A): confirmed — no production module imports.
- DI-8 (all scenarios `@skip`): confirmed.

### 6. One-at-a-time discipline — ✓

Every test function has `pytestmark = [pytest.mark.skip(reason="DISTILL: pending DELIVER phase NN")]` with a roadmap.json reference.

### 7. Mandate 7 (RED scaffolding) — N/A ✓

DI-7 correctly identifies this feature as not import-bearing. Tests use httpx, subprocess, pathlib — no production module imports.

### 8. Behavior-first filenames — ✓

All 10 filenames name an invariant or behavior, not a wave-methodology phase or MR number. Examples: `rrv7-handler-renders-existing-routes.feature`, `compose-topology-gains-one-service.feature`, `loader-forwards-bearer-to-auth-proxy.feature`.

### 9. roadmap.json coherence — ✓

- Phase 01 `scenarios_to_unskip`: 11 listed. Verified against .feature files — all exist.
- Phase 02 `scenarios_to_unskip`: 11 listed. Verified.
- Phase 03 `scenarios_to_unskip`: 8 listed. Verified.
- Phase 04 `scenarios_to_unskip`: 6 listed. Verified.

Total: 36 scenarios across the four phases.

### 10. Iron Rule preservation — ✓

- handoff-distill-to-deliver.md §4 explicitly states: "NEVER modify a failing test to make it pass."
- README.md §"Iron Rule reminder" elaborates on the forbidden mutations (adding `@skip`).
- Every test is scaffolded with `pytest.mark.skip(...)` initially, making RED the first state DELIVER hits when un-skipping.

---

## Particularly strong items

1. **Walking-skeleton restraint**: the single `@walking_skeleton` scenario genuinely measures user value (app renders after MR-0), not layer wiring. The .feature comment is explicit about this discipline.
2. **Strategy-C fixture discipline**: `requires_compose_stack` cleanly skips when `reverse-proxy` is unreachable. Zero complexity, clear failure modes. Mirrors the proven `tests/acceptance/ibis-as-only-sql-compiler/` pattern.
3. **Scenario-to-test alignment**: all 36 scenarios map 1:1 to test functions in roadmap.json's phase lists; verbatim scenario titles can be mechanically matched to test function names.
4. **DWD reconciliation**: wave-decisions.md reconciliation notes walk DESIGN's DWD-1..DWD-8 and flag zero contradictions. Praxis findings are encoded as Slice-4 scenarios (DI-5), not left hanging.
5. **Roadmap exit criteria**: each phase in roadmap.json has explicit `exit_criteria` tying each scenario list back to ADRs and DWDs. No ambiguity on what "done" means.

---

## Verdict

**APPROVED** (no blockers). The DISTILL wave is ready for DELIVER handoff.
