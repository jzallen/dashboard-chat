# Review by System Designer (Praxis) — frontend-coexistence DESIGN wave

**Reviewer:** nw-system-designer-reviewer (foreground critique, 2026-05-13)
**Wave:** DESIGN
**Verdict:** **PASS**
**Scope of this review:** system-level (topology, scalability, failure modes, build pipeline, operational readiness, inheritance, DISTILL handoff). The in-wave reviewer was `nw-solution-architect-reviewer` (application scope); this is the complementary system-scope pass.

The design is system-ready. All system-level decisions are locked by ADR-034 or correctly deferred to DELIVER. Topology is coherent, failure modes are identified, build pipeline is sound, and inheritance is faithful. Two MEDIUM-severity clarifications (F-1 Vite plugin scope, F-2 auth-proxy load estimate) are actionable. Two LOW-severity items (F-3 explicit scaling note, F-4 RAM baseline) are minor. No system-level blockers. Recommend proceeding to DISTILL.

---

## §1 Overall verdict

**PASS** — design is system-ready as-is. F-1 and F-3 are actionable inline edits to the design docs (small); F-2 belongs in DISTILL's acceptance tests; F-4 is a DELIVER measurement task.

---

## §2 Dimension grades

| Dimension | Grade | Notes |
|---|---|---|
| Topology coherence | A | Two-container model is precisely articulated; the +1 service delta is clear and bounded; ADR-015 routing rule survives byte-unchanged. |
| Failure mode coverage | A | SPOFs identified with plausible mitigations; reversibility is structural (MR-0 revert + per-route revert); no cascade failure paths introduced. |
| Scalability | B+ | Structurally scalable (stateless, scale-N ready), but lacks QPS budget for auth-proxy fan-out and RAM baseline validation for `web-ssr` bundle. |
| Build pipeline soundness | A | One-source-two-images pattern mirrors existing Bazel practice; image base `node_20_slim` matches `agent/` and `ui-state/`. |
| Operational readiness | B+ | Health checks + startup ordering specified; readiness probe, metrics, and loader timeout handling deferred to DELIVER. |
| Inheritance fidelity (ADR-015/031/033/034) | A | All binding clauses honored byte-for-byte or with documented substitutions; no ADR drift. |
| DISTILL handoff completeness | A | 8 BDD scenario groups + worked migration playbook + risks; DISTILL has enough to write concrete acceptance tests. |

---

## §3 Findings

### F-1 — `vite.config.ts` deferral note in §12 contradicts §10 load-bearing edit

- **Severity:** MEDIUM
- **Location:** `application-architecture.md` §10 (line 532) vs §12 (line 578)
- **Issue:** §10 correctly lists the `@vitejs/plugin-react` removal and `reactRouter()` addition as a **non-negotiable load-bearing MR-0 edit** (added by cartographer when addressing the in-wave reviewer's F-2). However, §12 ("What this DESIGN does NOT cover") lists "`vite.config.ts` exact edit — system-level deferred to DELIVER." The two clauses contradict each other: §10 says the Vite plugin removal is non-negotiable and locked at DESIGN; §12 says all vite.config.ts edits are deferred to DELIVER.
- **Recommended resolution:** Narrow §12's entry to clarify that the *decision* is locked in §10, but the *exact line edits and surrounding syntax* are DELIVER's concern. The plugin removal itself is not deferred.

### F-2 — No load estimate for auth-proxy fan-out under migration

- **Severity:** MEDIUM (design completeness, not correctness)
- **Location:** `application-architecture.md` §1 (scope statement), `c4-diagrams.md` §3 (sequence diagram), `handoff-design-to-distill.md` §"Risks"
- **Issue:** Every SSR'd route will cause `web-ssr` to call `auth-proxy` (one call per server request via `uiStateClient(request)`). The design does not estimate: "If X% of routes migrate to framework mode, how much additional load hits `auth-proxy`?" `auth-proxy` is a shared dependency for all incoming API requests via nginx; the new fan-out should be quantified to validate the design doesn't create an unintended SPOF.
- **Recommended resolution:** DISTILL should add an acceptance assertion: under a hypothetical 50% route-migration scenario, `auth-proxy` request volume increase is bounded. Even a rough budget ("≤ 10% above baseline") in the test gives DELIVER a concrete trigger to measure.

### F-3 — `web-ssr` horizontal scaling pattern not explicitly named in §6.4

- **Severity:** LOW (design is correct, just not made explicit)
- **Location:** `application-architecture.md` §6.4 (docker-compose entry), `c4-diagrams.md` §1
- **Issue:** §6.4 correctly specifies `expose: 3001` (internal only) and no `container_name`, consistent with the scale-N pattern used by `ui-state`. But §6.4 doesn't *explicitly state* that `web-ssr` is designed to scale horizontally (zero session affinity, stateless request handlers, request-scoped `QueryClient`). A reader of §6.4 in isolation might miss this.
- **Recommended resolution:** Add one sentence to §6.4 after the existing "No host port mapping" paragraph: "Like `ui-state`, `web-ssr` is designed for horizontal scaling: no session affinity, no fixed host port, and no `container_name` in the compose entry. Each instance is identical and stateless."

### F-4 — No RAM baseline validation for `web-ssr` bundle size

- **Severity:** LOW
- **Location:** `application-architecture.md` §6.3 (SSR image contents)
- **Issue:** ADR-031 estimated ~150 MB RAM for a Node-based frontend tier. The `web-ssr` image bundles the full `frontend/src/` tree (60+ React components + design system + TanStack Query + library imports). The ~150 MB estimate may be optimistic given the bundle scope.
- **Recommended resolution:** DELIVER should measure actual bundle size and RAM footprint at runtime. If it exceeds 150 MB, document the revision and update CLAUDE.md's architecture section if needed.

---

## §4 What's particularly strong

1. **Reversibility is structural, not rhetorical.** The design gives two concrete escape hatches (MR-0 revert via deleting the four new files + system-level changes; per-route revert via removing the `loader` export). Both are symmetric and carry no data-migration debt. Rare enough to be worth naming.

2. **The DWD decision discipline is clean.** Each DWD (DWD-1 through DWD-8) names a specific architectural choice, provides rationale, and specifies how to apply it. No DWD is aspirational or deferred without a concrete trigger. This is how you write binding decisions that DELIVER can execute against.

3. **Inheritance is explicit without being repetitive.** The design cites ADR-034 / ADR-031 / ADR-015 / ADR-033 at every relevant point but doesn't restate them — it applies them. The right balance between self-containedness and document duplication.

4. **The chat/SSE opt-out pattern (DWD-3) is well-reasoned.** Rather than forcing all routes to SSR or allowing none to, the design uses RRv7's `clientLoader` escape hatch to let SSE-bearing routes opt out gracefully. This preserves the ADR-015 nginx rule and avoids the false choice between "SSR everything" and "SSR nothing."

---

## §5 Recommendation for DISTILL handoff

**Ready to proceed with three clarifications (F-1, F-3 addressed inline; F-2 picked up as an acceptance scenario):**

### BDD scenario groups DISTILL should prioritize (from `handoff-design-to-distill.md` §"8 BDD scenario groups")

- **§3.1 — MR-0 visual parity.** Must pass for sign-off. Anchors the no-behavior-change property.
- **§3.8 — Container count delta.** Validates the topology change is +1 service.
- **§3.2 — SSR'd route migration.** Validates the loader + dehydration contract.
- **§3.3 — Reversibility.** Validates the structural escape hatch.

### Additional acceptance scenarios DISTILL should add

- **Loader timeout handling.** Given `auth-proxy` is slow (e.g., 10s response), when `web-ssr` receives a loader request, then the response is a 500 or a user-perceivable timeout — not a hang. (Addresses operational-readiness gap.)
- **Horizontal scale assertion.** Given two instances of `web-ssr` running behind a load balancer, when a request is routed to either instance, then both produce identical SSR'd HTML (no session affinity leakage).
- **auth-proxy fan-out bound.** Given a hypothetical migration profile where half of routes are framework-mode, when the system serves a representative request mix, then `auth-proxy` QPS increase is within a stated bound (e.g., ≤ 10% above baseline). (Addresses F-2.)

---

## §6 Reviewer constraints

### What I did NOT challenge (by binding scope)

- **ADR-034's eight immutable decisions** — topology, substrate, migration sequence, reversibility, Hono runtime, Bazel pattern, ADR-033 layer separation, trunk-based. These were ratified 2026-05-12 and are the system-level foundation. Re-litigation would invalidate the wave's premise.
- **ADR-031 §2 (nginx rules) and §7 (auth path).** Inherited unchanged. Verified the design honors them but did not question their rightness.
- **ADR-015 (presentation-state nginx rule).** Load-bearing and preserved verbatim. Out of scope to re-open.
- **Application-scope concerns** already covered by `review-by-solution-architect.md` (F-1..F-4 in that report). I focused on system-level gaps.

### What was in-scope for this review

- System-level topology coherence (new service placement, routing precedence, inter-service hops, failure modes).
- Scalability (load budgeting, horizontal scaling, capacity design).
- Build pipeline (image-target patterns, Bazel soundness).
- Operational setup (health checks, startup ordering, observability).
- Inheritance fidelity (all ADRs honored, no drift).
- DISTILL handoff (completeness, scenario coverage, actionability).

---

## §7 Resolution log

The findings above were partially addressed inline before this report was committed:

- **F-1:** ✓ Resolved inline — `application-architecture.md` §12 narrowed to specify that the *decision* (Vite plugin removal) is locked in §10; only exact line positions and surrounding syntax are deferred to DELIVER.
- **F-3:** ✓ Resolved inline — `application-architecture.md` §6.4 gains an explicit "Horizontal scaling property" paragraph naming the scale-N pattern, request-scoped `QueryClient`, and `docker compose up -d --scale web-ssr=N` as the supported scale-out path.
- **F-2:** Deferred to DISTILL — to be picked up as an acceptance-test scenario.
- **F-4:** Deferred to DELIVER — to be measured at runtime once the `web-ssr` image is built.

Recommend proceeding to DISTILL wave.
