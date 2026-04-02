# session-ownership Specification

## Purpose
Defines immutable session ownership and ownership-gated write operations, while allowing any org member to read all sessions.

## Requirements

### Requirement: Immutable session ownership

Every session SHALL have an `owner_id` set at creation time. Ownership SHALL be immutable -- it cannot be transferred or changed after creation.

#### Scenario: Owner set on creation

- **WHEN** a user creates a new session
- **THEN** the `owner_id` SHALL be set to the authenticated user's ID
- **AND** the `owner_id` SHALL NOT be changeable via any API endpoint

#### Scenario: Ownership recorded in database

- **WHEN** a session exists in the `sessions` table
- **THEN** the `owner_id` column SHALL be NOT NULL
- **AND** the value SHALL be a valid user ID

---

### Requirement: Ownership gates write operations

Only the session owner SHALL be able to perform write operations on a session (rename, delete).

#### Scenario: Owner can rename session

- **WHEN** the session owner sends a PATCH to update the title
- **THEN** the system SHALL allow the update

#### Scenario: Non-owner cannot rename session

- **WHEN** a user who is not the session owner sends a PATCH to update the title
- **THEN** the system SHALL return 403

#### Scenario: Any org member can read sessions

- **WHEN** a user in the same org requests the session list for a project
- **THEN** the system SHALL return all sessions regardless of ownership
- **AND** each session SHALL include the `owner_id` for display purposes
