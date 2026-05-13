<!-- DES-ENFORCEMENT : exempt -->
# Upstream issues + back-propagation events — Controller use-case injection refactor

**Feature slug:** `refactor-controller-use-case-injection`
**Wave:** DISTILL
**Status:** Proposed
**Companion:** `wave-decisions.md`, `roadmap.json`

This document records (a) any blocking upstream issues surfaced during DISTILL that DELIVER must know about, and (b) back-propagation events — surgical edits made to upstream-wave artefacts during DISTILL document-reconciliation per the `nw-distill` skill protocol.

## §1 Back-propagation events (process artefacts, not issues)

### §1.1 — Kwarg canonicalisation: `_use_cases` confirmed in DESIGN

**Trigger.** User-ratified naming compromise during DISTILL: the kwarg should be `_use_cases` (full word, leading underscore) rather than `_uc` (terse, original sketch) or `use_cases` (no test-seam signal). Captured as DISTILL DWD-1.

**Files inspected for back-propagation:**

- `docs/decisions/adr-023-controller-use-case-injection.md`
- `docs/feature/refactor-controller-use-case-injection/design/design.md`
- `docs/feature/refactor-controller-use-case-injection/design/c4-diagrams.md`
- `docs/feature/refactor-controller-use-case-injection/design/wave-decisions.md`
- `docs/feature/refactor-controller-use-case-injection/design/upstream-changes.md`

**Disambiguation rule applied (per DISTILL DWD-1).**

| Token shape | Decision |
|---|---|
| `_uc=` / `_uc:` (parameter position, NEW kwarg) | rename → `_use_cases=` / `_use_cases:` |
| `_default_<aggregate>_uc` / `_default_uc` (factory function name) | KEEP AS-IS |
| `_uc()` (call expression in CURRENT code being replaced) | KEEP AS-IS |
| `_uc` mentioned in narrative prose as "the existing getter" | KEEP AS-IS |
| `mock_uc`, `fake_uc`, `fake_upload_uc` (caller-side test variables) | KEEP AS-IS |

**Substitutions applied to DESIGN docs:** **0**.

**Why zero?** A line-by-line audit of the five DESIGN files showed every `_use_cases` token already in kwarg position uses the canonical full-word name (e.g. `*, _use_cases=_default_uc` on `design.md:49`, `_use_cases=_default_<aggregate>_uc` on `wave-decisions.md:15`, `kw-only _use_cases=_default_uc` on `c4-diagrams.md:43`). Every remaining `_uc` token in the DESIGN files falls into a KEEP-AS-IS bucket above (factory function names, current-code call expressions, narrative prose about the existing getter, or caller-side test-variable identifiers). Per DISTILL DWD-1's "prefer KEEPING the original" guidance for ambiguous cases, no edits were necessary.

**Outcome.** DESIGN and DISTILL agree on `_use_cases` as the canonical kwarg name. The naming convention is captured in DISTILL DWD-1 so DELIVER does not regress it. No upstream files modified during this DISTILL pass.

**This is a documented event, not an issue.** Recording it here so a future reader auditing wave-to-wave alignment can see that the rename was inspected and confirmed (rather than silently skipped).

### §1.2 — DISTILL artefacts already use `_use_cases` exclusively in kwarg position

**Verification.** A grep of the four `.feature` files plus `steps/controller_di_steps.py` plus `conftest.py` shows zero kwarg-position uses of `_uc=`. Every kwarg-position reference uses `_use_cases=` (e.g. `controller-accepts-injected-use-case-factory.feature:49` `_use_cases=lambda: capture.fake_use_cases`; `controllers-expose-use-cases-injection-point.feature:39` `the parameter "_use_cases" is keyword-only`; `tests-use-kwarg-injection-without-patches.feature:53` `added _use_cases=lambda: mock_uc arguments on controller calls`).

**Outcome.** DISTILL deliverables are internally consistent with DISTILL DWD-1 from the moment they were authored. No edits required.

## §2 Upstream issues surfaced during DISTILL

### §2.1 — None blocking

DISTILL did not surface any blocking upstream issues. Specifically:

- **DESIGN DWD-2 ordering check.** DESIGN DWD-2's Mikado sequence (per-controller transform → per-controller test rewrite → repeat → arch rule → atomic alias-block deletion) is internally consistent and maps cleanly onto DISTILL's four-phase `roadmap.json`. No reordering required.
- **DESIGN DWD-3 FastAPI Depends non-interaction.** The architectural rule's third sub-rule (γ-prevention: no `Depends(<X>Controller` in routers) is testable as written; DISTILL's milestone-3 scenarios encode both directions (synthetic violator + clean tree).
- **DESIGN DWD-7 no-probe contract.** Acceptance suite has no probe; conftest has no substrate fixture; consistent with DESIGN DWD-7's "no substrate that can lie".
- **Reviewer checklist alignment.** DESIGN's `upstream-changes.md` §6 reviewer checklist enumerates 13 boolean checks. Every check has a corresponding scenario in milestones 2 or 3, OR is a `git diff` audit gate that the DELIVER PR submitter runs (not an acceptance scenario). No coverage gap.

### §2.2 — Soft notes for DELIVER

These are not blockers but warrant attention during DELIVER kickoff:

#### Note A — Pre-migration assertion capture mechanism

`tests-use-kwarg-injection-without-patches.feature`'s "byte-identical assertions" scenario depends on a captured snapshot of the pre-migration assertion lines. The step body's TODO suggests `git show origin/main:backend/tests/controllers/<file>` as the capture mechanism. DELIVER should confirm at kickoff time that origin/main still points at the pre-migration commit (i.e. no other PR has merged into main between this DISTILL handoff and the DELIVER PR's branch creation that touches `backend/tests/controllers/`). If a sibling PR mutates `backend/tests/controllers/` first, the snapshot must be taken from the merge-base of this DELIVER PR with origin/main, not from origin/main directly.

#### Note B — Synthetic-violator harness invocation surface

`architectural-rule-prevents-kwarg-injection-regression.feature`'s synthetic-violator scenarios construct candidate files in `tmp_path` and feed them through the same `pytest-archon` machinery the production rule uses. DELIVER should confirm that pytest-archon's API supports being invoked against a synthetic source-tree subset (some versions only support the entire installed package). If it doesn't, the scenarios degrade to a regex-based check on file contents, which is strictly weaker. Captured here so DELIVER doesn't discover this on the first DELIVER red-bar.

#### Note C — `_serialize` / `_error_response` re-exports stay (DESIGN DWD-5)

The acceptance suite explicitly avoids touching these two re-exports. The `tests-use-kwarg-injection-without-patches.feature` scenarios scope their grep to `*_use_cases` aliases and `_uc()` getters; they do NOT scan for `_serialize` / `_error_response` removal. This is correct: per DESIGN DWD-5, those re-exports are out-of-scope and must remain in `http_controller.py` after this refactor lands.

#### Note D — Fast-path applies (4 features × ~5 scenarios = 22 scenarios; not 3-or-fewer)

This DISTILL bundle has 22 scenarios across four feature files. The `nw-acceptance-designer` fast-path threshold ("3 or fewer scenarios") does not apply. Full review with critique-dimensions runs at handoff time.

## §3 Confirmation

After DISTILL handoff:

- `git diff --stat origin/main..HEAD` shows changes only under `docs/feature/refactor-controller-use-case-injection/distill/` and `tests/acceptance/refactor-controller-use-case-injection/`.
- `git diff origin/main..HEAD docs/feature/refactor-controller-use-case-injection/design/` is empty (no DESIGN edits applied; rename was already in effect).
- `git diff origin/main..HEAD docs/decisions/adr-023-controller-use-case-injection.md` is empty (same).
- `grep -rn ", _uc=" tests/acceptance/refactor-controller-use-case-injection/` returns zero (DISTILL artefacts use canonical name).
- `grep -rn ", _uc:" tests/acceptance/refactor-controller-use-case-injection/` returns zero.
