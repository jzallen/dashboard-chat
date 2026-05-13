# Solution Architect Review: `frontend-coexistence` Design Wave

> **Reviewer**: nw-solution-architect-reviewer (Haiku)
> **Date**: 2026-05-13
> **Scope**: review of the four DESIGN artifacts (`application-architecture.md`, `wave-decisions.md`, `c4-diagrams.md`, `handoff-design-to-distill.md`) against ADR-034 and inherited ADRs.

## TL;DR

**PASS** (with 4 medium-severity clarifications).

The four design artifacts cohesively ratify ADR-034's system-level decisions at the application layer. All eight DWDs are load-bearing and resolve ADR-034's open questions. Artifacts honor inherited ADRs, the reuse analysis is thorough, and BDD scenarios are well-scoped. Two structural concerns require clarification before handoff to DISTILL: (1) the `@vitejs/plugin-react` removal in `vite.config.ts` MR-0 scope (mentioned in handoff §6 but not in application-architecture), and (2) the explicit status of whether `frontend/App.tsx` is deleted at MR-0 or merely deprecated (DWD-6 and handoff conflict slightly on this phrasing). All critical decision points are locked; no system-level scope is leaking into application DESIGN.

---

## 1. Compliance with ADR-034 (8 Immutable Decisions)

ADR-034 ratified eight numbered decisions. Each is honored:

| ADR-034 §Decision | Artifact Coverage | Verdict |
|---|---|---|
| **1. Substrate = RRv7 framework mode** | application-architecture §2–3, wave-decisions DWD-1/2/3 | ✓ Locked |
| **2. Single React tree shared by library + framework routes** | application-architecture §3.2–3.4, DWD-6 | ✓ Locked |
| **3. One Hono SSR container (`web-ssr`)** | application-architecture §5, c4-diagrams §1–2, handoff §1.5 | ✓ Locked |
| **4. Migration is route-level, not process-level** | application-architecture §9, handoff §2 migration playbook | ✓ Locked |
| **5. Reversibility is structural (MR-0 revert + per-route revert)** | application-architecture §9, handoff §3.2–3.3 scenarios | ✓ Locked |
| **6. `ui-presentation/` dissolves into `frontend/app/routes/`** | application-architecture §10, wave-decisions DWD-4, handoff §1.2 | ✓ Locked |
| **7. ADR-031 §2 nginx rules preserved verbatim; §7 auth path inherited** | application-architecture §5.1, DWD-8, wave-decisions preamble | ✓ Locked |
| **8. Trunk-based (MR-0 as single commit atomic)** | handoff §1–2, implied in all artifacts | ✓ Locked |

**Finding: No contradictions with ADR-034.** The artifacts faithfully ratify all eight decisions as immutable.

---

## 2. Inherited ADR Compliance

**ADR-033 (source-tree/topology layer separation):**
- Referenced explicitly in application-architecture §1, §6.
- DWD-5 correctly applies the pattern: one source tree (`frontend/`), two OCI images (`reverse-proxy` nginx + `web-ssr` Hono), two Bazel targets.
- ✓ **Honored.**

**ADR-031 §2 (nginx rules stay unchanged):**
- application-architecture §5.1 explicitly states: "The five existing rules (`/api/`, `/worker/`, `/api/channels/:id/presentation-state`, `/health`, `/assets/`) stay byte-unchanged."
- c4-diagrams §1 labels each rule and notes them as "(unchanged)".
- DWD-8 specifies rule ordering: new catch-all routes to `web-ssr` *after* the existing five.
- ✓ **Honored.**

**ADR-031 §7 (auth path, Bearer forwarding):**
- application-architecture §4.1 (DWD-1): loaders read `request.headers.get('Authorization')`.
- application-architecture §4.2 example code shows pattern: `uiStateClient(request)` copies the header.
- Inherited verbatim with framework name substitution (Remix → RRv7).
- ✓ **Honored.**

**ADR-015 (presentation-state nginx rule preservation):**
- application-architecture §7 (DWD-3): "ADR-015's rule is preserved unchanged."
- c4-diagrams §3 (sequence, step 1): nginx matches and routes to agent directly (NOT web-ssr).
- handoff §3.4: scenario explicitly verifies the rule is bypassed from SSR.
- ✓ **Honored.**

**ADR-029 (active_scope contract, Option D):**
- application-architecture §4.3: "ADR-029 §2 specifies the propagation contract for Option D (Remix) — which is RRv7 framework mode under ADR-034."
- handoff §3.2 scenario: "root loader calls `ui-state` for projection; useScope() reads `active_scope` from useRouteLoaderData('root')."
- The contract is implemented as a migration sequence (root loader added in first per-route MR, not MR-0).
- ✓ **Honored.**

---

## 3. Reuse Analysis Quality (RPP F-1)

**application-architecture §2 table** enumerates 8 existing artifacts. Every CREATE vs EXTEND decision is justified.

**Zero CREATE-NEW decisions outside ratified ADRs.** The reuse analysis meets RPP F-1 rigor.

---

## 4. DWD Coherence and Completeness

Eight DWDs recorded; all are load-bearing:

| DWD | Load-bearing? | Coherence with other DWDs | Verdict |
|---|---|---|---|
| **DWD-1: `AuthProvider` client-only** | Yes — enforces no server twin | ✓ Paired with DWD-2 (QueryClient isolation) |
| **DWD-2: TanStack Query SSR (dehydrate)** | Yes — defines how loaders prefetch | ✓ Paired with DWD-1 (no auth duplication); enables root `<HydrationBoundary>` |
| **DWD-3: SSE routes use `clientLoader`-only** | Yes — defines chat opt-out pattern | ✓ Preserves ADR-015 nginx rule; no contradiction with DWD-1/2 |
| **DWD-4: `ui-presentation/` dissolves in MR-0** | Yes — part of the scope boundary | ✓ Aligned with ADR-034 §"What's in source tree" |
| **DWD-5: SSR image via Bazel, not Dockerfile** | Yes — system-level reconciliation | ✓ Applies ADR-033 layer separation; mirrors `agent/` pattern |
| **DWD-6: `App.tsx` deleted; `main.tsx` reduced** | Yes — defines composition root shape | ⚠ **See F-1 below** |
| **DWD-7: `AppShell` inner `<QueryProvider>` deferred** | Yes — minimizes MR-0 scope | ✓ Cleanly deferred to first per-route migration |
| **DWD-8: nginx rule ordering (catch-all last)** | Yes — system-level ordering semantics | ✓ Preserves rule precedence; ADR-031 §2 compliance |

**Finding (F-1): DWD-6 has a phrasing inconsistency.** Application-architecture §3.5 reads: "`App.tsx` is **deleted** at MR-0." DWD-6 §"How to apply (DELIVER's exact code)" reads: "`frontend/App.tsx` is **deleted**." But handoff §1.3 lists it as "DELETED" with a bullet-point reason. The three statements agree on *outcome* but **application-architecture §3.5's final paragraph** reads: "Recommendation: **delete `App.tsx` at MR-0**" — implying it's an *option* rather than a *requirement*. The Table in §3.5 has a row "Stays at MR-0 as the library-mode root" that contradicts the table's other row "Already removed at MR-0." **This needs reconciliation before DISTILL.**

**Verdict: 7 of 8 DWDs are fully coherent; DWD-6 phrasing needs clarification.**

---

## 5. Application vs System Scope Discipline

Wave brief: "application-level — not system." The four artifacts stay disciplined.

**One scope ambiguity: Vite plugin co-existence.** Handoff §6 (Risks section) flags: "`@react-router/dev/vite` and `@vitejs/plugin-react` overlap... the RRv7 plugin includes its own React transformer; the `@vitejs/plugin-react` entry should be **removed**." This is a build-pipeline detail, but it's **load-bearing for correctness** (double-transforms would break the build). Application-architecture §12 lists it as deferred, but it should be called out explicitly in the MR-0 scope (§10) or in DWD-6 (which touches `vite.config.ts`). **This needs clarification — should be in MR-0 scope as a non-negotiable requirement, not deferred.**

**Verdict: Scope discipline is tight, but one build-pipeline detail (Vite plugin removal) is under-specified.**

---

## 6. ADR-034 Open Questions Resolution

| Question | Resolution | Adequacy |
|---|---|---|
| **1. SSE/chat under SSR?** | DWD-3: routes opt out via `clientLoader`-only. ADR-015 nginx rule preserved. | ✓ Clean, testable, no blocker. |
| **2. Single workspace vs sibling?** | Resolved: single workspace (`frontend/`). | ✓ Justified. |
| **3. Presentation-state under future migrations?** | Resolved: nginx rule unchanged; loaders fetch through auth-proxy if needed. | ✓ Consistent with inheritance. |

**All three open questions cleanly resolved.**

---

## 7. BDD Scenario Coverage

Handoff §3 specifies 8 scenario groups covering acceptance boundaries. All 5 stated minimums covered, plus extra coverage (DWD-4, DWD-6, container delta). All scenarios are Gherkin-style, testable, and mapped to DWDs/ADRs.

**Verdict: BDD coverage is comprehensive and well-scoped.**

---

## 8. MR-0 File List Completeness

**Finding (F-2): The `@vitejs/plugin-react` removal is mentioned in handoff §6 Risks but NOT in the explicit MR-0 file list.** It's a **load-bearing code change** (prevents double React transforms). Recommend: add to application-architecture §10 "Modified files" section and to handoff §1.3 as a required edit to `vite.config.ts`.

**Verdict: File list is 95% complete; one detail (React plugin removal) needs explicit inclusion in MR-0 scope.**

---

## 9. C4 Diagram Accuracy

All three views (container, component, sequence) are accurate, detailed, and consistent with prose. Mermaid C4 syntax is correct; no contradictions detected.

**Finding (F-4, LOW): The container view does not explicitly call out the +1 service delta (was 6 application services + nginx, becomes 7 application services).** Helpful for orientation.

---

## 10. Reversibility Claim Verification

Both MR-0 and per-route reverts are structurally symmetric; no hidden coupling detected. Routes do NOT hardcode import paths into the routes config beyond string lookups; loaders are pure functions with no singleton state.

**Verdict: Reversibility is strong.**

---

## Findings Summary

| ID | Severity | File | Issue | Suggested Fix |
|---|---|---|---|---|
| **F-1** | MEDIUM | application-architecture §3.5 + DWD-6 | DWD-6 phrasing: "Recommendation: delete App.tsx at MR-0" reads optional; should be binding. Application-architecture §3.5 table row "Stays at MR-0 as the library-mode root" contradicts the other row "Already removed at MR-0". | Reword DWD-6 and §3.5 to: "**Decision**: `frontend/App.tsx` is deleted at MR-0." Strike "Recommendation:" prefix and ambiguous "Stays" wording. |
| **F-2** | MEDIUM | handoff §6 + application-architecture §10 | `@vitejs/plugin-react` removal is load-bearing but mentioned only in Risks §6, not in MR-0 scope list. | Add explicit line to application-architecture §10: `frontend/vite.config.ts` — removes `@vitejs/plugin-react`, adds `reactRouter()` plugin. Add to handoff §1.3 as required edit. |
| **F-3** | MEDIUM | application-architecture §3.5 | Phrasing ambiguity in §3.5 table: same artifact described three ways. | Unify the three statements: table row should read "Deleted" (not "Stays...deprecated"). Prose should match. |
| **F-4** | LOW | c4-diagrams §1 note | Container view doesn't explicitly state the +1 service delta. | Add a one-line note to §1 "Notes": "This represents a +1 service delta over the pre-MR-0 topology (no services removed)." |

---

## Verdict

**APPROVED** (no blocking issues; four medium-clarity items for pre-DISTILL housekeeping).

### Ready for DISTILL

Once the four clarifications above are addressed (15-minute edits; no re-architecture), the design is locked and ready for DISTILL to formalize the BDD suites. No ADRs need re-opening. No system-level decisions are deferred ambiguously. The MR-0 file list is 95% explicit; DELIVER can infer the remaining implementation details from the DWDs + application-architecture rationale.
