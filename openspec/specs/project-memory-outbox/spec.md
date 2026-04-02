# project-memory-outbox Specification

## Purpose
Emits ProjectCreated outbox events and consumes them to provision Stream channels and project_memories rows, ensuring reliable memory provisioning with idempotency.

## Requirements

### Requirement: ProjectCreated outbox event

The system SHALL emit a `ProjectCreated` outbox event when a project is created. The event payload SHALL include `project_id`, `org_id`, and `created_by`.

#### Scenario: Event emitted on project creation

- **WHEN** the `create_project` use case successfully inserts a project
- **THEN** a `ProjectCreated` event SHALL be submitted to the outbox repository
- **AND** the event's `aggregate_type` SHALL be `"project"`
- **AND** the event's `aggregate_id` SHALL be the new project's ID

#### Scenario: Event payload contains required fields

- **WHEN** a `ProjectCreated` event is stored
- **THEN** the payload SHALL contain `project_id`, `org_id`, and `created_by`

---

### Requirement: Memory provisioning from outbox event

The system SHALL consume the `ProjectCreated` outbox event to provision a Stream channel and create a `project_memories` row. Provisioning SHALL be called synchronously within the `create_project` use case.

#### Scenario: Stream channel created from event

- **WHEN** the `provision_project_memory` use case processes a `ProjectCreated` event
- **THEN** a Stream channel SHALL be created with ID `proj_{compactOrgId}_{compactProjectId}`
- **AND** a `project_memories` row SHALL be inserted with the channel ID
- **AND** the outbox event SHALL be marked as processed

#### Scenario: Idempotent provisioning

- **WHEN** `provision_project_memory` is called for a project that already has a memory
- **THEN** the system SHALL NOT create a duplicate channel or row
- **AND** the operation SHALL succeed without error

#### Scenario: Provisioning failure does not orphan the project

- **WHEN** Stream channel creation fails (network error, API error)
- **THEN** the outbox event SHALL remain unprocessed
- **AND** the project creation transaction SHALL still commit (project exists, memory pending)
- **AND** the event can be retried later
