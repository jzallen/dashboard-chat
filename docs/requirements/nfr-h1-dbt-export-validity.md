# NFR-H1: dbt Export Validity

## Tag

H1 — Handoff: Correctness

## Ambition

Ensure that exported dbt projects are syntactically valid and can be parsed by dbt without errors.

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Exports a project with datasets, views, and reports |
| **Environment** | Normal operation |
| **Artifact** | dbt export pipeline |
| **Response** | The exported zip contains a valid dbt project that passes `dbt parse` without errors |
| **Response Measure** | All model files, schema YAML, macros, and profiles.yml present and syntactically correct |

## Status

**Implemented** — 4-layer export. No automated validation against `dbt parse`.

## Verification Method

Export a project and run `dbt parse` against the exported zip. Verify all model files, schema YAML, macros, and profiles.yml are present and syntactically correct.

## Related

- dbt export pipeline
