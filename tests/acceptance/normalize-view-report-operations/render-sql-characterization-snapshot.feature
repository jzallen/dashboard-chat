# <!-- DES-ENFORCEMENT : exempt -->
# Walking-skeleton acceptance for normalize-view-report-operations (ADR-052).
#
# Strategy: real I/O via SQLite + real ibis->DuckDB rendering (DWD-1 in
# distill/wave-decisions.md). The relations are real rows seeded through the
# RepositoryContainer.metadata persistence surface; the SQL is rendered by the
# real ViewIbisCompiler / ReportIbisCompiler through
# ibis.to_sql(dialect="duckdb"). No compose stack; no in-memory doubles. If the
# real SQLite adapter or the real ibis renderer were swapped for a stub, this
# scenario would silently pass and prove nothing about render-equivalence
# (Mandate 6 litmus test).
#
# This is the brownfield walking skeleton and the HARD GATE before the
# renderer-consolidation phase (slice 02 / Phase 02): no renderer change is safe
# until this snapshot is pinned. It ships observable value on its own — an
# engineer can dump and inspect the exact SQL any relation compiles to today.
# The driving port is the RepositoryContainer (its .metadata persistence
# surface) plus the production characterization harness that re-derives SQL from
# persisted state (the reproducibility invariant, AC1).

@walking_skeleton @real-io @characterization @driving_port
Feature: Render-SQL characterization snapshot pins every relation's compiled SQL
  As an engineer about to refactor the renderer,
  I want a characterization snapshot of the SQL every existing view and report
  compiles to today
  So that no later slice changes rendered output by accident.

  Background:
    Given a fresh relation store seeded with a representative view and report

  Scenario: Every seeded view and report pins its compiled SQL
    When the characterization harness renders every seeded relation to SQL
    Then each relation pins a non-empty compiled SQL string

  Scenario: A deliberate change to rendered SQL fails the snapshot with a per-relation diff
    When the characterization harness renders every seeded relation to SQL
    Then a deliberate change to a relation's rendered SQL fails the snapshot with a per-relation diff

  Scenario: Re-rendering with no change is deterministic
    When the characterization harness renders every seeded relation to SQL
    Then re-rendering with no change reproduces the identical snapshot
