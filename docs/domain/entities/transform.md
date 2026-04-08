# Transform

## Bounded Context

Data Modeling

## Purpose

A Transform represents a non-destructive data transformation applied to a Dataset. Transforms come in four types (filter, clean, alias, map) and follow a strict three-stage pipeline execution order. They generate SQL via Ibis without modifying the underlying Parquet files.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `dataset_id` | varchar(36) | yes | — | FK → datasets |
| `name` | varchar(255) | yes | — | — |
| `description` | text | no | — | — |
| `condition_json` | json | conditional | — | Required for `filter`; forbidden otherwise |
| `condition_sql` | text | no | generated | Generated from `condition_json` for `filter` |
| `version` | integer | yes | — | — |
| `status` | varchar(20) | yes | `enabled` | `enabled`, `disabled`, `deleted` |
| `transform_type` | varchar(20) | yes | — | `filter`, `clean`, `alias`, `map` |
| `target_column` | varchar(255) | conditional | — | Required for `clean`, `alias`, `map`; forbidden for `filter` |
| `expression_sql` | text | no | generated | Generated from `expression_config` |
| `expression_config` | json | conditional | — | Required for `clean`, `alias`, `map`; forbidden for `filter` |
| `nl_prompt` | text | no | — | Natural language prompt that created this transform |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Invariants

1. **Type system field exclusivity**
   Four transform types with mutually exclusive field requirements:

   | transform_type | condition_json | condition_sql | target_column | expression_config | expression_sql |
   |:-:|:-:|:-:|:-:|:-:|:-:|
   | `filter` | required | generated | forbidden | forbidden | forbidden |
   | `clean` | forbidden | forbidden | required | required | generated |
   | `alias` | forbidden | forbidden | required | required | generated |
   | `map` | forbidden | forbidden | required | required | generated |

   **Enforced in:** `backend/app/routers/schemas/dataset.py` — `TransformCreate` Pydantic `@model_validator(mode='after')`
   **Specified in:** `openspec/specs/cleaning-transforms/spec.md` — Requirement: Cross-Field Validation

2. **Valid cleaning operations**

   | Operation | Requires target_column type | Config fields |
   |:----------|:---------------------------|:--------------|
   | `trim` | text only | — |
   | `upper` | text only | — |
   | `lower` | text only | — |
   | `title` | text only | — |
   | `snake` | text only | — |
   | `kebab` | text only | — |
   | `fill_null` | any | `fill_value` |
   | `map_values` | text only | `mappings: [{from, to}]` |
   | `alias` | any | `alias_name` |

   **Enforced in:** `backend/app/routers/schemas/dataset.py` — `CleaningExpression._validate()`
   **Specified in:** `openspec/specs/cleaning-transforms/spec.md` — Requirement: Expression Storage

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Dataset | many-to-one | Transform belongs to a dataset |

## Lifecycle

| Current State | Event | Next State | Guard |
|:--------------|:------|:-----------|:------|
| `enabled` | `undoCleaningTransform(action: disable)` | `disabled` | — |
| `enabled` | `undoCleaningTransform(action: delete)` | `deleted` | — |
| `disabled` | `reEnableCleaningTransform` | `enabled` | — |
| `disabled` | `undoCleaningTransform(action: delete)` | `deleted` | — |
| `deleted` | any | blocked | Terminal state |

**Reversibility:** `enabled` ↔ `disabled` is reversible. Transition to `deleted` is permanent.

**Enforced in:** `backend/app/use_cases/dataset/update_transforms.py` — batch update accepts status changes
**Specified in:** `docs/diagrams/state/transform-status.mermaid`, `openspec/specs/cleaning-transforms/spec.md`

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `InvalidExpressionConfig` | 400 | Expression config fails validation |
| `ColumnTypeMismatch` | 422 | Transform target column has incompatible type |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Dataset](dataset.md) — parent entity
