## ADDED Requirements

### Requirement: Source Reference Storage

The system SHALL store source references on Views and Reports as a JSON array field (`source_refs`), where each entry identifies a dependency by ID and type.

- Each entry in `source_refs` SHALL have `id` (string, UUID of the referenced entity) and `type` (string, either `"dataset"` or `"view"`).
- Views SHALL accept source references of type `"dataset"` or `"view"`.
- Reports SHALL accept source references of type `"dataset"` or `"view"`.
- Reports SHALL NOT reference other Reports (no mart-to-mart dependencies).

#### Scenario: View with mixed source types

- **WHEN** a View is created with `source_refs: [{"id": "ds-1", "type": "dataset"}, {"id": "view-1", "type": "view"}]`
- **THEN** the stored `source_refs` SHALL contain both entries

#### Scenario: Report referencing a View

- **WHEN** a Report is created with `source_refs: [{"id": "view-1", "type": "view"}]`
- **THEN** the stored `source_refs` SHALL contain the View reference

---

### Requirement: Source Reference Validation

The system SHALL validate that all referenced sources exist at View/Report creation and update time.

- When creating or updating a View or Report, the system SHALL verify that every ID in `source_refs` corresponds to an existing Dataset or View in the same project.
- If any referenced entity does not exist, the system SHALL return a 400 error with a message identifying the missing reference(s).
- The system SHALL NOT enforce source references via database foreign keys (JSON field limitation).

#### Scenario: Create View with valid references

- **WHEN** a View is created with `source_refs` pointing to existing Datasets in the same project
- **THEN** the creation SHALL succeed

#### Scenario: Create View with invalid reference

- **WHEN** a View is created with `source_refs: [{"id": "nonexistent", "type": "dataset"}]`
- **THEN** the system SHALL return 400 with detail indicating the missing reference

#### Scenario: Update Report with deleted source

- **WHEN** a Report's `source_refs` are updated to include a View that has been deleted
- **THEN** the system SHALL return 400 with detail indicating the missing reference

---

### Requirement: Circular Dependency Prevention

The system SHALL prevent circular dependencies in the source reference graph.

- When creating or updating a View, the system SHALL verify that no cycle exists in the dependency graph (View A → View B → View A).
- Cycle detection SHALL use depth-first traversal of the `source_refs` graph.
- If a cycle is detected, the system SHALL return a 400 error with a message describing the cycle.
- Dataset references SHALL terminate the traversal (Datasets have no `source_refs`).

#### Scenario: Direct circular reference

- **WHEN** View A has `source_refs: [{"id": "view-b", "type": "view"}]` and View B is updated with `source_refs: [{"id": "view-a", "type": "view"}]`
- **THEN** the system SHALL return 400 with detail indicating the circular dependency

#### Scenario: Transitive circular reference

- **WHEN** View A → View B → View C, and View C is updated to reference View A
- **THEN** the system SHALL return 400 with detail indicating the cycle

#### Scenario: Diamond dependency is allowed

- **WHEN** View A and View B both reference Dataset D, and View C references both View A and View B
- **THEN** the creation SHALL succeed (diamond shapes are valid DAGs)

---

### Requirement: DAG-Ordered Export

The system SHALL export Views and Reports in dependency order so that dbt can resolve `{{ ref() }}` calls.

- The export SHALL resolve `source_refs` IDs to the correct dbt model names (e.g., `stg_orders`, `int_orders_enriched`).
- The export SHALL respect the DAG: staging models before intermediate, intermediate before marts.
- If a source reference points to a deleted entity, the export SHALL fail with a clear error identifying the broken reference and affected model.

#### Scenario: Export resolves View references to ref() calls

- **WHEN** a View "Orders Enriched" has `source_refs` pointing to Dataset "Orders" (id: ds-1)
- **THEN** the exported SQL SHALL contain `{{ ref('stg_orders') }}` (not the raw UUID)

#### Scenario: Export fails on broken reference

- **WHEN** a View references a Dataset that has been deleted
- **THEN** the export SHALL return an error with the View name and the missing reference ID
