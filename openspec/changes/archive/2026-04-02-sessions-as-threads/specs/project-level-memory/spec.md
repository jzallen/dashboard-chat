## ADDED Requirements

### Requirement: All sessions share a project memory

All sessions within a project SHALL be threads in the same Stream channel (memory). The memory's custom data SHALL hold project-scoped context.

#### Scenario: Sessions reference the same channel

- **WHEN** two sessions exist for the same project
- **THEN** both sessions' `memory_id` SHALL reference the same `project_memories` row
- **AND** both Stream threads SHALL exist within the same Stream channel

#### Scenario: Memory custom data contains project context

- **WHEN** a project memory is created
- **THEN** the Stream channel's custom data SHALL include `project_id` and `org_id`

---

### Requirement: Thread-based conversation continuity

The agent SHALL use the thread ID to reconstruct conversation context from prior messages in the same session.

#### Scenario: Agent receives thread context

- **WHEN** a chat request includes a `thread_id`
- **THEN** the agent SHALL load prior messages from the Stream thread
- **AND** the agent SHALL include those messages in the LLM conversation context

#### Scenario: New session has no prior context

- **WHEN** a chat request includes a `thread_id` for a newly created session
- **THEN** the agent SHALL proceed with only the current message (no prior context)
