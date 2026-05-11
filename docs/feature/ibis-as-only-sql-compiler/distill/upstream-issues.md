# Upstream Issues — `ibis-as-only-sql-compiler` — DISTILL

**Feature:** ibis-as-only-sql-compiler
**Wave:** DISTILL
**Date:** 2026-05-11
**Author:** Quinn (nw-acceptance-designer), under crew dispatch

## Findings

**No upstream issues surfaced during DISTILL.**

[ADR-026](../../../decisions/adr-026-ibis-as-only-sql-compiler.md) was
ratified at write-time (Accepted 2026-05-11, merge `ef65252`) with no
Proposed→Accepted handshake per its §"Decision outcome" item 4. The decision
document, the source research at
[`docs/research/deterministic-sql-construction-architecture.md`](../../../research/deterministic-sql-construction-architecture.md),
and the prior CEL evaluation at
[`docs/research/ibis-cel-deterministic-sql.md`](../../../research/ibis-cel-deterministic-sql.md)
together carried enough contract surface to derive every acceptance scenario
without a single back-propagation question.

Each of the four contracts in ADR-026 §"Decision outcome" (tier-by-tier ibis
adoption; dbt macro emission via ibis-source plugin; no backfill / no
grandfather / no flag-gate for legacy report SQL; no free-text `expr` escape
hatches) is expressible as one or more observable outcomes a scenario can
assert. The MR roadmap (5 MRs, MR-1 + MR-3 carry new behavior) is concrete.
The driving ports (the view-creation use case and the report-creation use
case) are existing facades — no new port surface needs designing.

The DISCUSS / DIVERGE / DISCOVER skip per CLAUDE.md brownfield routing
(refactoring with ratified ADR enters at DISTILL) did NOT cost anything in
DISTILL — every acceptance criterion derives from ADR-026 + the research doc,
which together carry all the contract surface DISCUSS would have produced as
user-stories acceptance criteria. Refactoring features with ratified
architecture do not need user stories; the ADR is the contract.

## Format note

This file exists as a placeholder for the DESIGN→DISTILL contract: "if
DISTILL surfaces any gap or contradiction in upstream waves, record it here
so DELIVER and future architects can trace the back-propagation." For this
feature, the file is empty by design.

If a gap surfaces during DELIVER's TDD cycle, the software-crafter should
append findings here rather than silently re-interpreting the ADR. Examples
of findings worth back-propagating:

* A scenario cannot be made green without violating an ADR-026 constraint
  (e.g., requires a `.replace("'", "''")` defense to close the injection
  vector instead of ibis literal escaping). Flag here, do NOT modify the
  test; the contradiction is upstream.
* The dbt-ref-renderer ibis-source plugin (MR-2) cannot emit the
  `{{ ref(...) }}` shape that the walking-skeleton scenario asserts. Flag
  here; if a deeper ibis-source pattern is required, file an ADR-026
  amendment.
* A future analyst pattern surfaces requiring a free-text computation
  (e.g., `revenue * tax_rate`). Per ADR-026 §"Decision outcome" item 3, the
  answer is a typed `ComputedField` discriminated-union variant — file an
  amendment ADR; do NOT reintroduce the `expr` field.
