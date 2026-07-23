# DISTILL → DELIVER handoff — ui-state hexagonal-transport (ADR-040 LEAF-1..6)

**Wave:** DISTILL (brownfield REFACTOR migration — not a new feature)
**Produced:** 2026-05-16
**Branch:** `distill/ui-state-hexagonal-transport`
**Binding spec:** `docs/decisions/adr-040-ui-state-hexagonal-transport.md`
**This document IS the artifact ADR-040's reviewer-mandated prerequisite requires** (ADR-040 Consequences: *"DISTILL handoff prerequisite ... the overseer's acceptance of the hard-swap posture ... MUST be re-confirmed in writing in the DISTILL handoff"*).

---

## 1. BINDING LEAF-5 HARD-SWAP DECISION — RE-CONFIRMED VERBATIM

> **LEAF-5 is a SINGLE HARD SWAP (event-log → SettledStateStore in one MR), behind the binding byte-equivalence gate. The overseer explicitly chose this over the safer 3-step dual-write→read-swap→drop sequence (speed over safety net, risk owned). Sequence LEAF-5 as ONE step in roadmap.json with the equivalence test as its RED gate. Do NOT decompose it into 5a/5b/5c.**

(Overseer re-confirmed 2026-05-16, recorded verbatim per ADR-040's reviewer-mandated prerequisite.)

**DELIVER crafter, read this twice:** when you pick up LEAF-5 you implement the **single hard swap** behind the equivalence gate. You do **NOT** silently substitute the safer dual-write → read-swap → drop-writes sequence. ADR-040 Consequences itself pre-rejected the alternative. The equivalence gate (`ui-state/lib/hexagonal-transport/leaf-5-settled-state-store-equivalence.test.ts`) is the safety net that replaced the dual-read parity window. The risk is owned at the overseer level; your job is to make the gate green, not to re-introduce the dual-write window for safety.

LEAF-5 ships as **one MR with two commits, in order**:

- **Commit A (the gate, FIRST):** un-skip the equivalence spec; implement it against the **existing legacy** `buildProjection(eventLog.read() ++ [terminalEvent])` path for every J-002 state-history fixture; it goes **GREEN against legacy = baseline locked**. No production read-port change in this commit.
- **Commit B (the swap):** introduce `SettledStateStore`; `settle → store.set`; `GET /projection → store.get`; delete `buildProjection`'s event-log path **and** the entire `harvestSettled*` family (`ui-state/lib/orchestrator-harvester.ts`) in this same MR. The gate from Commit A now runs `store.set/get` and **MUST stay byte-equivalent** to the legacy projection captured in the fixtures.

---

## 2. Per-LEAF regression gate (RG-LEAF) — binding, every LEAF

Defined machine-readably in `roadmap.json` → `regression_gate_definition`. Every LEAF (1..6) is gated by **all** of:

1. `cd ui-state && npx vitest run` green (incl. the LEAF's own un-skipped spec).
2. `cd ui-state && npx eslint .` → **0 errors** (incl. ADR-030 LEAF-D `no-orchestrator-snapshot-reads` on the carved orchestrator).
3. The J-002 acceptance suite — `tests/acceptance/project-and-chat-session-management/` — run **PER-MARKER** (`-m mr_1` … `-m mr_6`, each pytest invocation separate), **ZERO regression** vs the J-002 FINALIZE baseline: **mr_4 14/0/0 · mr_5 7/0 · mr_6 8/0**.
4. `./tools/test/test.sh --auto` (merge-queue gate).

**The acceptance suite is the inherited behavioral SSOT (the OUTER pin).** It is **REFERENCED**, never duplicated, and **never weakened, re-skipped, or marker-edited** to make a LEAF pass (nwave Iron Rule + brownfield discipline). The new `ui-state/lib/hexagonal-transport/*.test.ts` specs pin only the structural/contract deltas the acceptance suite cannot see.

**Known hazard — D-MR5-02 (out of scope, do NOT fix):** pre-existing full-suite shared-`dev-user-001` ordering fragility. RG-LEAF runs the suite **per-marker** specifically so this fragility cannot mask or manufacture a regression signal. Do not attempt to fix it inside this refactor.

---

## 3. Characterization-first discipline (brownfield Iron Rule)

This refactor touches UNTESTED-AT-THE-SEAM legacy (the ~1939-L orchestrator + parameterized routes). Per Feathers + the project's brownfield rule, **behavior-neutral LEAFs MUST be pinned by characterization BEFORE the refactor** — the brownfield analog of the walking skeleton:

| LEAF | Behavior | Test type | Pin |
|---|---|---|---|
| LEAF-1 | neutral | characterization + structural | acceptance-suite reuse + "no per-machine conditional in carved path; dispatch via registry" |
| LEAF-2 | neutral | **new contract** | path-surface alias contract (canonical ≡ legacy, no 404 window) |
| LEAF-3 | neutral | characterization + structural | acceptance-suite reuse + "orchestrator is a generic pump, no fan-out" |
| LEAF-4 | neutral | characterization | US-210 mr_6 FREEZE/THAW replay byte-behavior-identical post-extraction |
| **LEAF-5** | **behavior-changing** | **new binding contract** | **the byte-equivalence gate (the centerpiece)** |
| LEAF-6 | neutral (post FE-migration) | **new contract** | precondition (FE migrated) gate + post-removal 404 |

LEAF-5 is the **only** behavior-changing LEAF; the only thing that may change is the read-port *source*, and the observable `GET /projection` payload **must remain byte-identical** — which is exactly what the equivalence gate proves.

---

## 4. Dependency order (strict, sequential)

`LEAF-1 → LEAF-2 → LEAF-3 → LEAF-4 → LEAF-5 → LEAF-6`

Each LEAF is independently mergeable through the refinery queue (`gt mq submit`) but **MUST land in order** — later LEAFs assume earlier structure (LEAF-2 mounts the LEAF-1 registry's strategies; LEAF-3 carves into the LEAF-1 port; LEAF-4 extracts from the LEAF-3 pump; LEAF-5 swaps the read-port the LEAF-4 adapters sit beside; LEAF-6 deletes the LEAF-2 alias). One LEAF per `/nw-deliver` pass.

---

## 5. Test spec inventory (DISTILL output — RED/skip, DELIVER un-skips)

All under `ui-state/lib/hexagonal-transport/` (vitest `lib/**/*.test.ts` glob); all `describe.skip` with DELIVER-deferred reasons; the binding contract lives in the spec headers + the `it` titles + the typed fixtures + `roadmap.json` criteria:

- `leaf-1-strategy-registry.test.ts`
- `leaf-2-router-factory-alias-surface.test.ts`
- `leaf-3-orchestrator-pump-carve.test.ts`
- `leaf-4-intent-buffer-freeze-thaw-adapters.test.ts`
- `leaf-5-settled-state-store-equivalence.test.ts` ← **the gate; exhaustive J-002 state-history catalogue**
- `leaf-6-alias-removal.test.ts`

DELIVER removes the `.skip` for the LEAF it is executing and implements to GREEN. **Iron Rule:** a skipped spec is implemented to green or the LEAF does not land — never weakened to pass. After 3 failed attempts on a step, revert and escalate.

The acceptance suite is **not** modified by DISTILL (it is the OUTER pin). LEAF-6 is the only LEAF that touches it (path migration to canonical), and only while keeping it green per-marker.

---

## 6. Canonical vs legacy path map (for LEAF-2 / LEAF-6)

| Vocabulary | Legacy segment | Canonical machine-name | True alias pair? |
|---|---|---|---|
| feature-slug | `/flow/project-and-chat-session-management` | `/flow/project-context` | **YES** — LEAF-2 aliases, LEAF-6 removes |
| machine-name | `/flow/session-chat` | `/flow/session-chat` | no (canonical ≡ legacy; stable) |
| flow-name | `/flow/login-and-org-setup` | `/flow/login-and-org-setup` | no (canonical ≡ legacy; stable) |

Registry key = canonical machine-name (ADR-040 D5 / ADR-039). The alias is **HTTP-routing-level, not registry-level** (same router instance, extra mount point). `flow-id` (`<machine-name>:<principal_id>`) is explicitly **rejected** as the registry key (instance id, not dispatch key).

---

## 7. Scope guardrails (do not cross)

- Do **NOT** implement any LEAF — that is DELIVER. DISTILL produced contracts; DELIVER fulfils them.
- Do **NOT** re-open ADR-040's ratified decisions (hexagon depth, hybrid store, hard swap). DISTILL distils them; it does not re-litigate.
- Do **NOT** fix D-MR5-02 (run the gate per-marker around it).
- Do **NOT** modify the finalized J-002 evolution archive (`docs/evolution/2026-05-16-project-and-chat-session-management/`) — read-only.
- No "harness"/"nwave"/"fault-injection" vocabulary in product code/names (ADR-039 C11). The TS test harness (`harness.j002.*`) + acceptance suite are pre-existing grandfathered test infra — referencing/extending them is fine.
