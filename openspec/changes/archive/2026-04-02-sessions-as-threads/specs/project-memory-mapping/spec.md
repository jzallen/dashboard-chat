## ADDED Requirements

### Requirement: One memory per project

The system SHALL maintain exactly one memory (Stream channel) per project, recorded in the `project_memories` table. The mapping SHALL be enforced by a UNIQUE constraint on `project_id`.

#### Scenario: Memory exists for every project

- **WHEN** a project exists in the `projects` table
- **THEN** a corresponding row SHALL exist in `project_memories` with a valid `stream_channel_id`
- **AND** the `org_id` on the memory row SHALL match the project's `org_id`

#### Scenario: Duplicate memory creation rejected

- **WHEN** a second memory is created for a project that already has one
- **THEN** the system SHALL raise a unique constraint violation
- **AND** the existing memory SHALL remain unchanged

---

### Requirement: Project-scoped Stream channel ID format

Memory channels SHALL use the format `proj_{compactOrgId}_{compactProjectId}` where `compactId` strips hyphens from the UUID.

#### Scenario: Channel ID generated from project

- **WHEN** a memory is provisioned for project `550e8400-e29b-41d4-a716-446655440000` in org `660e8400-e29b-41d4-a716-446655440001`
- **THEN** the `stream_channel_id` SHALL be `proj_660e8400e29b41d4a716446655440001_550e8400e29b41d4a716446655440000`

#### Scenario: Channel ID is deterministic

- **WHEN** the same project and org IDs are used
- **THEN** the generated channel ID SHALL always be identical

---

### Requirement: Memory retrieval endpoint

The system SHALL expose `GET /api/projects/{project_id}/memory` to return the project's memory metadata.

#### Scenario: Memory retrieved for valid project

- **WHEN** an authenticated user requests the memory for a project they have access to
- **THEN** the system SHALL return the `stream_channel_id` and `created_at` fields
- **AND** the response status SHALL be 200

#### Scenario: Memory retrieval for nonexistent project

- **WHEN** a user requests the memory for a project that does not exist
- **THEN** the system SHALL return 404

#### Scenario: Memory retrieval respects org scoping

- **WHEN** a user in org A requests the memory for a project in org B
- **THEN** the system SHALL return 403 or 404
