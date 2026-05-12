# Review Report: Dashboard Chat Topology Complexity

**Date:** 2026-05-12
**Reviewer:** Praxis (`nw-system-designer-reviewer`)
**Scope:** Compose topology (`docker-compose.yml`) + ADRs 001–031 + in-flight `user-flow-state-machines` DESIGN artifacts
**Branch:** `review/topology-complexity`
**Verdict:** **APPROVED with clarifications**
**Grade:** **B+**

---

## Executive Summary (60-second read)

The dashboard-chat topology has grown from ~4 services to ~9 (7 default + optional `postgres`/`mirth`) through deliberate, evidence-cited feature accretion. Every component — including the in-flight `flow-state` and `frontend-remix` tiers — has a stated bottleneck or boundary justification in its ADR, and trade-off documentation across ADRs 027, 030, 031 is exceptional (alternatives + explicit losses named). The architecture has not "grown by accretion" in the pejorative sense; it has grown by ratified decisions. That said, three gaps deserve attention before DELIVER closes: (1) ADR-030's capacity math is correct but its underlying Node-process assumptions (single core, FD ceiling) are implicit rather than stated; (2) the `flow-state` ↔ `frontend-remix` consolidation question — the overseer's specific concern — has no numerical rebuttal in any current artifact even though the architectural rationale is sound; (3) Redis's widening SPOF blast radius is acknowledged in ADR-030 and `system-architecture.md` §12 but not tracked to a DEVOPS ticket. None of these are blocking. Tier count is justified by team size + scaling shape + failure-isolation needs, not accretion.

**On the specific consolidation question:** Keep `flow-state` and `frontend-remix` separate. Evidence-based rebuttal in Finding #4 below — scaling curves differ (compute-bound vs I/O-bound), failure modes differ (Redis-hard-fail vs degrade-gracefully), and merging saves ~0 MB while sacrificing both.

---

## Findings (Priority-Ordered)

### Blocking

**None.** No SPOF without stated mitigation. No component without justification. No order-of-magnitude estimation error.

---

### Suggestions (Non-Blocking) — High Priority

#### 1. `suggestion (non-blocking):` ADR-030 capacity math is correct, but underlying Node-process assumptions are implicit

**Dimension:** Scalability claims / Estimation accuracy
**Citations:**
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` §0 (capacity envelope)
- `docs/feature/user-flow-state-machines/design/system-architecture.md:23-84` (estimation block §0.1–§0.4)

ADR-030 and the in-flight `system-architecture.md` estimate flow-state scaling with welcome precision: 300 actors at 1× (~155 MB), 3,000 actors at 10× (~195 MB); 110 ops/sec on Redis at 1× → 1,100 ops/sec at 10×; 8 projection-read QPS at 1× → 83 QPS at 10×. The math checks out (`300 × 15 KB + 150 MB Node baseline ≈ 154.5 MB`; `300 users × 1 event/sec + 8 projection reads/sec ≈ 108 ops/sec`).

**But the implicit assumptions are not labelled:**
- Single-core Node process baseline. Hono routing + XState reducer at p95 ~3 ms means sustained CPU should be <5% at 10×, which is conservative and defensible — *but the document doesn't say so*.
- SSE connection ceiling at 10× (1,000 concurrent SSE) relies on Node's default 65 535 FD limit per process. There is no headroom beyond 10× without kernel tuning, and that ceiling is never named.

A production operator reading ADR-030 cold gets the arithmetic but not the failure modes that bound it.

**Recommendation:** Add a short "Capacity Assumptions" subsection to ADR-030 §0 naming: (a) the assumed Node CPU/RAM envelope per replica; (b) the p95 transition latency budget; (c) the FD ceiling and the point at which it becomes the binding constraint.

---

#### 2. `suggestion (non-blocking):` Auth-proxy multi-upstream change is implicit DELIVER work, not pre-costed

**Dimension:** Component justification / Trade-off honesty
**Citations:**
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` §1 (≈ line 59: "~30 lines of Hono routing + tests")
- `docs/feature/user-flow-state-machines/design/system-architecture.md` §1.7 (auth-proxy routing rule)
- `docs/decisions/adr-016-auth-proxy-in-test-stack.md` (auth-proxy as sole production ingress)

ADR-030 mandates that auth-proxy gain a new `/flow-state/*` upstream rule, citing ~30 lines of Hono routing as the implementation cost. That code delta is plausibly accurate, but it understates the surface area:

1. **Review surface.** Auth-proxy is production-critical (ADR-016 makes it the sole privileged ingress). Any new routing rule is a behaviour change with rollback complexity beyond the line count.
2. **Sequencing.** Is the multi-upstream rule a prerequisite (must land before DELIVER) or part of DELIVER itself? Neither ADR-030 nor the design doc says.
3. **Regression risk.** Hono's router is mature, but the existing single-upstream config is *proven* stable. Cross-talk between `/api/*` and `/flow-state/*` must be excluded by contract tests.

**Recommendation:** During roadmap planning (DISTILL → DELIVER), break the auth-proxy change into its own story with explicit acceptance criteria: (a) contract test for `/flow-state/*` routing; (b) regression test for `/api/*` (no crosstalk); (c) compose-level integration test verifying end-to-end auth-proxy → flow-state. Estimate effort separately from the flow-state core work.

---

#### 3. `suggestion (non-blocking):` Redis SPOF blast radius is acknowledged but not tracked to a mitigation ticket

**Dimension:** SPOF analysis
**Citations:**
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` "Consequences" → "Negative" (Redis blast-radius warning)
- `docs/feature/user-flow-state-machines/design/system-architecture.md` §12 "Top-3 system risks" (item 3)
- `docker-compose.yml` (Redis service: single instance, no Sentinel/Cluster)

ADR-030 is admirably direct about the growing risk:

> "Redis blast radius grows. Redis now backs three logs (`flow:`, `session:`, `presentation-state:`). A Redis outage takes down all three; Redis was already a SPOF, but the consequence widens."

`system-architecture.md` §12 repeats the warning verbatim and proposes mitigations (per-prefix `maxLen`, operator runbook to add Redis HA before the next service joins the substrate, independent tier probes). This is radical candor — the risk is named, not hidden.

**But there is no tracking artifact** ensuring Redis HA actually lands before the substrate grows to a fourth key prefix. Today's compose runs single-instance Redis. The next feature that touches Redis will either add a fourth prefix without HA (deepening the SPOF) or have to do HA work itself (out-of-band).

**Recommendation:** As part of DESIGN→DISTILL handoff, file a DEVOPS bead with success criterion "Production Redis runs as Sentinel (active-passive auto-failover) or Cluster" and an explicit gate: blocking production deployment of any new feature that adds a fourth Redis key prefix. The gate, not the warning, is what prevents regression.

---

### Suggestions (Non-Blocking) — Medium Priority

#### 4. `suggestion (non-blocking):` Flow-state vs frontend-remix consolidation question has architectural answer but no numerical rebuttal

**Dimension:** Component justification (this is the overseer's specific concern)
**Citations:**
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` §1.3–§1.5 (flow-state single-replica rationale)
- `docs/decisions/adr-031-frontend-tier-transition-remix-alongside-nginx.md` §1, §4 (Remix as separate container; strangler-fig rationale)
- `docs/feature/user-flow-state-machines/design/system-architecture.md` §1.1–§1.7

**The overseer asks: should `flow-state` and `frontend-remix` be one service?**

The current artifacts answer this implicitly: ADR-031 explains why Remix is a separate container (reversibility, strangler-fig migration alongside nginx-SPA), and ADR-030 explains why flow-state is single-replica with fixed host port and in-process XState actor tree. **No artifact directly compares "two services" vs "one merged service" on quantified terms.**

The architectural answer is right; the documentation gap is real. Here is the numerical rebuttal the artifacts should make explicit:

| Dimension | `flow-state` (separate) | `frontend-remix` (separate) | Merged service |
|---|---|---|---|
| Bottleneck class | Compute-bound (XState actor tree) | I/O-bound (projection fetch + route render) | Mixed — must over-provision one |
| Scaling shape | Single-replica, vertical scale (ADR-030 §1.4) | Stateless, horizontal scale (ADR-031 §1) | Locked to flow-state's single-replica constraint |
| 10× envelope | 3 000 actors, ~195 MB, ~p95 3 ms | 83 QPS projection reads, <1 % CPU | Either under-provisioned for Remix QPS or over-provisioned for actor RAM |
| Redis dependency | Hard-fail on startup (ADR-027 §6) | None at startup; degrades gracefully | Remix inherits flow-state's hard-fail contract — non-flow routes can't serve during Redis outage |
| Crash blast-radius | Sign-in + scope transitions (MTTR ~30 s rehydrate) | Route-loader failure → ErrorBoundary on failing routes only | Single crash kills both flow + every Remix-served route |
| RAM saving from merge | — | — | ~0 MB (Node baseline ~150 MB is per-process; merging removes one baseline only if you also delete one process supervisor — typically negligible) |

**The merged-service case loses on every dimension except "one fewer container in `docker compose ps`."**

**Recommendation:** Add a short subsection to `docs/feature/user-flow-state-machines/design/system-architecture.md` (after §1.4 or alongside §1.7) titled "Why flow-state and frontend-remix remain separate services" containing the table above. This converts an implicit architectural conclusion into an evidence-cited one, closing the overseer's question for future reviewers.

---

#### 5. `suggestion (non-blocking):` ADR-008 (MinIO/S3) has no capacity model for Parquet storage

**Dimension:** Estimation accuracy / Component justification
**Citations:**
- `docs/decisions/adr-008-minio-s3-file-storage.md` (decision body; argues for object storage over local FS but states no capacity)
- `docker-compose.yml` (MinIO service: `command: server /data`, single instance, no distributed mode)
- `docs/decisions/adr-003-duckdb-pg-duckdb-analytics.md` (DuckDB external Parquet reads)

ADR-008 justifies MinIO/S3 on architectural grounds (decoupled storage, httpfs reads from DuckDB) but says nothing about volume:

- Datasets per org at 1× / 10× — not stated.
- Average Parquet file size — not stated.
- Total storage at 10× scale — not stated.
- Strategy when per-org storage grows beyond single-instance MinIO — not stated.

The compose configuration (single-instance MinIO, `server /data`) is fine for dev and small prod, but there is no documented trigger for evaluating Distributed MinIO mode or migrating to managed S3. Asymmetry: flow-state is pressure-tested on memory at 10× but the existing storage tier isn't sized at all.

**Recommendation:** Add a short capacity section to ADR-008 (or a follow-on ADR) naming: (a) assumed dataset count per org and median Parquet size at 1× and 10×; (b) the threshold (e.g., per-org storage > 100 GB, or total bucket > 1 TB) that triggers an evaluation of Distributed MinIO vs managed S3; (c) a DEVOPS ticket for the migration trigger, similar to the Redis-HA suggestion above.

---

#### 6. `suggestion (non-blocking):` `query-engine` resource limits aren't tied to a documented concurrency model

**Dimension:** Component justification / Scalability claims
**Citations:**
- `docker-compose.yml:95-99` (query-engine `deploy.resources.limits: memory: 2G, cpus: "2.0"`)
- `docs/decisions/adr-003-duckdb-pg-duckdb-analytics.md` (pg_duckdb justification)

The query-engine container is the only one in the compose with explicit `deploy.resources.limits`. The 2 GB / 2 vCPU envelope is presumably justified by some assumption about concurrent materialisations, but neither ADR-003 nor `docker-compose.yml` says so. Questions the docs don't answer:

- N concurrent materialisations assumed at 2 GB?
- Single-threaded DuckDB query vs parallel scan — which is the binding case?
- On OOM, does the container restart cleanly? Does it cascade to the backend API (which depends on it)?

**Recommendation:** Add a "Capacity Model" subsection to ADR-003 (or a co-located note in `docker-compose.yml` comments) naming the concurrent-materialisation assumption, the per-query RAM ceiling, and the scaling trigger (queue-and-backpressure vs second replica sharded by `org_id`).

---

### Nitpicks (Non-Blocking)

#### 7. `nitpick (non-blocking):` `agent` service comment block doesn't mention the new `flow:` Redis prefix

**Dimension:** Pattern applicability / Operational clarity
**Citations:**
- `docker-compose.yml:14-25` (agent comment block)
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` (introduces `flow:` key prefix on shared Redis)

The agent's comment block accurately describes its own Redis prefixes (`presentation-state:`, `session:`) but predates ADR-030's introduction of the `flow:` prefix on the same Redis instance. As-is, an operator reading this comment cold won't realise the agent now shares Redis with a third workload.

**Recommendation:** When the flow-state DELIVER lands, update the agent comment to note Redis is now shared with the flow-state tier, with a pointer to ADR-030 + `system-architecture.md` §12 for the SPOF/scaling discussion.

---

#### 8. `nitpick (non-blocking):` Frontend↔agent specialisation boundary is fuzzy and undocumented

**Dimension:** Pattern applicability
**Citations:**
- `docs/decisions/adr-016-auth-proxy-in-test-stack.md` (ADR-016 declares auth-proxy the sole production ingress)
- `docs/feature/user-flow-state-machines/design/system-architecture.md` §1.7 (notes ADR-016 is "aspirational, not currently honored for the agent")
- `frontend/nginx.conf` (the `/worker/` and `/api/channels/:id/presentation-state` rules bypass auth-proxy)

`system-architecture.md` §1.7 is admirably honest that ADR-016 is partially observed (auth-proxy fronts backend but not agent). But there's no decision on whether the nginx-bypass is a permanent pattern (SSE buffering concerns? latency?) or technical debt to be repaid.

**Recommendation:** Either a brief follow-on ADR or a paragraph in ADR-030 closing the question — "agent ingress through auth-proxy is deferred because [reason], and will be revisited when [trigger]."

---

### Praise

#### 9. `praise:` Trade-off documentation across ADR-027, ADR-030, and ADR-031 is genuinely exemplary

**Citations:**
- `docs/decisions/adr-030-flow-state-topology-and-scaling.md` §1.3 — three-option matrix (single-replica α / multi-replica stateless β / sticky multi-replica γ) compared on ~9 dimensions with explicit losses named for each.
- `docs/decisions/adr-031-frontend-tier-transition-remix-alongside-nginx.md` §4 — R1/R2/R3 options compared on ~12 dimensions including operational/migration cost.
- `docs/decisions/adr-001-hono-over-express.md` — Hono vs Express trade-offs named (edge-runtime compatibility, ecosystem maturity).

This is what trade-off honesty looks like: every major decision names not just "we chose X" but "we rejected Y because [quantified or qualified loss]." This level of clarity reduces future second-guessing, supports reversibility (an explicitly-rejected option can be revisited with full context), and is markedly better than the industry average. Keep doing this.

#### 10. `praise:` Probe contract per ADR-027 §6 is a strong operational primitive

**Citations:**
- `docs/decisions/adr-027-flow-state-tier-and-framework.md` §6 (probe contract: refuse startup on dependency failure)
- `docs/feature/user-flow-state-machines/design/system-architecture.md` §6 (probe propagation in compose)

The "refuse startup if Redis isn't reachable; emit `health.startup.refused`" contract is a clean fail-fast pattern. It's also correctly applied: probes are per-tier, independent, and don't share state — so a Redis outage shows up as three tier-level failures rather than one ambiguous "the system is broken." This is the right way to build SPOF-aware health checking.

---

### Question

#### 11. `question (non-blocking):` Is `mirth` still part of the active topology, or is it a vestigial reservation?

**Dimension:** Pattern applicability
**Citations:**
- `docker-compose.yml` (mirth service, profile-gated)
- Nothing in ADRs 001–031 references mirth's role.

`mirth` (and `postgres`) appear in compose but are profile-gated. `postgres` clearly maps to a prod-parity option for SQLite→Postgres testing. `mirth` is less obvious — none of the ADRs explain its role in the topology. Is it (a) a future HL7/healthcare integration target tied to ADR-012, (b) an experiment that should be removed, or (c) something else?

This is a *question*, not an issue — if mirth has a stated owner and roadmap, fine. If not, profile-gated dead services accumulate review friction.

---

## Dimension-by-Dimension Scoring

| Dimension | Grade | Notes |
|---|---|---|
| Component justification | A | Every active service has a stated bottleneck or boundary justification; the new tiers (flow-state, Remix) are justified in ADR-027/030/031 |
| SPOF analysis | A− | SPOFs identified, mitigations stated; Redis HA mitigation lacks a tracked owner/ticket (Finding #3) |
| Scalability claims | B+ | Quantified where it matters (flow-state, projection QPS); capacity assumptions for `query-engine` and `MinIO` are implicit (Findings #5, #6) |
| Trade-off honesty | A | ADR-027/030/031 trade-off matrices are exemplary (Finding #9) |
| Pattern applicability | A− | Tier count is justified by team scale + failure-isolation needs; frontend↔agent boundary fuzzy (Finding #8); mirth role unclear (Finding #11) |
| Estimation accuracy | B+ | Math checks out; underlying Node-process / FD-ceiling assumptions implicit (Finding #1); auth-proxy delta under-costed (Finding #2) |

---

## Specific Recommendation: Flow-State vs Frontend-Remix Consolidation

**Question:** Should `flow-state` and `frontend-remix` be one service rather than two?

**Evidence-based answer: No. Keep them separate. The current decision is correct; what's missing is the explicit numerical rebuttal in the docs.**

The full reasoning is in Finding #4 above. Summary: scaling-shape mismatch (compute-bound vs I/O-bound), failure-mode mismatch (Redis hard-fail vs degrade-gracefully), and the merge saves essentially zero RAM while losing both. Operational simplicity is a real value but is not optimised by merging here; it's optimised by keeping concerns separate so an operator can pinpoint failures.

The action item is documentary, not architectural: add the rebuttal table from Finding #4 to `docs/feature/user-flow-state-machines/design/system-architecture.md` so the next reviewer doesn't have to re-derive it.

---

## Approval

**APPROVED.** No blocking issues. The topology is well-justified, trade-offs are documented, SPOFs are named. Proceed to DISTILL/DELIVER with the four clarifications:

1. ADR-030 §0 — add a "Capacity Assumptions" subsection (Finding #1).
2. DELIVER roadmap — break out the auth-proxy multi-upstream change as its own story with explicit acceptance criteria (Finding #2).
3. DEVOPS — file a Redis HA bead with a gate on the next feature that would add a fourth Redis key prefix (Finding #3).
4. `system-architecture.md` — add the flow-state-vs-Remix rebuttal table from Finding #4.

Findings #5–#8 are non-blocking improvements; address opportunistically. Finding #11 is a question — answer when convenient.

---

## Method Note

This review was conducted by `nw-system-designer-reviewer` (Praxis) under the standard rigor profile, applying the framework: component justification, SPOF analysis, scalability claims, trade-off honesty, pattern applicability. All citations are repo-relative paths so they remain valid across crew workspaces (`umpire`, `kestrel`, etc.) sharing the same branch lineage. No artifact was modified by this review.
