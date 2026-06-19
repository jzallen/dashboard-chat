# Slice 02 — Reject malformed operations at the boundary

**Story:** US-2 · **Sub-job:** SJ-2 · **ADR-051:** D4 / decision 5 · **Effort:** ~1 day

## Goal (one sentence)
Validate operation shape at the use-case boundary before persistence, so a malformed operation is rejected with a structured error and never persists or silently degrades to broken SQL.

## IN scope
- A Pydantic **discriminated union** over the operation discriminator (`filter | clean | alias | map`), mirroring `ViewFilterVariant` (`view.py:154-214`, `parse_view_filter`).
- Wire validation into `create_transforms` (`create_transforms.py`) and `update_transforms` **before** `create_transforms_batch` writes (`repository.py:657-671`).
- Structured `422` at `POST` / `PATCH /api/datasets/{id}/transforms` naming the offending field / discriminator value.

## OUT scope
- The `sequence` work (Slice 01) — independent.
- Renderer refactor (Slice 03). The `-- Error generating SQL` fallback (`dataset_sql.py:46-50`) stays as a guard but should become unreachable for validated operations; *removing* it is not in this slice.

## Learning hypothesis
**Disproves** that a boundary discriminated union can reject **every** malformed shape the renderer currently swallows into a `-- Error generating SQL` comment. If a malformed operation still reaches the renderer after this slice, the union is incomplete and the validation contract is not yet closed-world.
**Confirms** the View-tier boundary-validation pattern generalizes to the staging operation vocabulary.

## Acceptance criteria
- AC1: `POST` with an unknown discriminator value → `422`; body names the discriminator; the operations list is unchanged (nothing persisted).
- AC2: `POST` with a known discriminator but a missing required field → `422` naming the field; nothing persisted.
- AC3: A well-formed operation set still persists successfully (no regression).
- AC4: For the malformed inputs in AC1/AC2, **no** `-- Error generating SQL` comment is produced anywhere downstream.

## Dependencies
None hard. Blocks Slice 05 (the M parser emits operations through this same boundary).

## Reference class
`ViewFilterVariant` discriminated-union boundary validation already shipped in this repo (`view.py:79-82,154-214`). `backend-use-case` skill for the decorator stack + error format (`Failure(e)` / `isinstance(result.failure(), SomeDomainException)`).
