# Documentation

Architectural documentation for Dashboard Chat — a chat-first data platform that takes users from raw files to production-ready analytics via natural language.

## Product Vision

**[Read the full vision](vision.md)** — Upload → Model → Access → Visualize

```
Upload files  ──►  Model with chat  ──►  dbt export + SQL/ODBC access  ──►  Auto-generate dashboards
  (complete)         (complete)              (complete)                        (planned)
```

## Contents

### Vision & Roadmap

- [Product Vision](vision.md) — End-to-end user journey and what makes this different

### Architecture

High-level system design and service topology.

- [C4 Container Diagram](architecture/c4-containers.mermaid) — 9 services (incl. planner) and their interactions
- [Agent Topology](architecture/agent-topology.mermaid) — Chat worker context routing and tool execution
- [Auth Flow](architecture/auth-flow.mermaid) — Dev mode vs WorkOS authentication paths
- [Data Flow](architecture/data-flow.mermaid) — Upload through query with trust boundaries
- [Backend Layers](architecture/backend-layers.md) — Router → Controller → UseCase → Repository

### Domain

Core business concepts and data model.

- [Entity-Relationship Diagram](domain/erd.mermaid) — All 11 database tables with relationships
- [Dataset Lifecycle](domain/dataset-lifecycle.md) — Upload → transform → query pipeline
- [Tool Call Registry](domain/tool-call-registry.md) — All chat agent tools with parameter schemas
- [Business Rules](domain/business-rules.md) — Per-entity invariants, type systems, lifecycle rules, and authorization model

### API

- [Endpoints](api/endpoints.md) — 52 REST endpoints across 12 routers

### Diagrams

Interaction and state diagrams for key user flows.

**Sequence Diagrams:**
- [Chat Interaction](diagrams/sequence/chat-interaction.mermaid) — Message → SSE stream → tool execution
- [File Upload](diagrams/sequence/file-upload.mermaid) — Upload → format detection → dataset creation
- [Auth Login](diagrams/sequence/auth-login.mermaid) — Login → token exchange → org provision
- [SQL Access Provisioning](diagrams/sequence/sql-access-provision.mermaid) — Enable SQL → pg_duckdb → connection string

**State Diagrams:**
- [Upload Status](diagrams/state/upload-status.mermaid) — pending → processing → completed/failed
- [Transform Status](diagrams/state/transform-status.mermaid) — enabled ↔ disabled → deleted

### Decisions

- [Architecture Decision Records](decisions/adrs.md) — 11 ADRs covering key technology choices

### Requirements

- [Non-Functional Requirements](requirements/nfr.md) — Performance, security, scalability, reliability

### Guides

Engineering guides and conventions.

- [Design Decisions](guides/design.md) — Code organization, testability, testing strategy
- [CSS Modules Guide](guides/css-modules.md) — Domain-specific CSS naming with Tailwind

### Infrastructure

- [Docker Topology](infrastructure/docker-topology.mermaid) — Service graph with profiles and dependencies

## Related Resources

These resources live outside `docs/` but are integral to the project's documentation:

- **[Feature Specifications](../features/)** — 12 Gherkin feature files with 361 scenarios defining behavioral contracts
- **[OpenSpec](../openspec/)** — 94 specification directories covering all domains with structured change management
- **[CLAUDE.md](../CLAUDE.md)** — Developer workflow guide, conventions, and quick commands
- **[CHANGELOG.md](../CHANGELOG.md)** — Version history
