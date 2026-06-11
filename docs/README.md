# Documentation

> **`docs/` is an nwave-managed folder — do not relocate or rename it.**
>
> nwave-ai (our SDLC framework, see [ADR-013](decisions/adr-013-nwave-adoption.md)) hardcodes `docs/` as its knowledge-base root. The path is not configurable: it is baked into the wave agent/skill prompts **and** into the DES runtime. Specifically, the DELIVER-wave DES hooks construct `docs/feature/{feature-id}/deliver/execution-log.json` from the repo root at runtime — no path is passed in — so moving `docs/` silently breaks enforcement rather than erroring loudly. A symlink is the only safe relocation, and we've chosen not to depend on one (devs would have to remember to recreate it per environment).
>
> **nwave owns these subtrees** (generated/curated by waves; ADRs are referenced by the wave prompts):
> `feature/` · `evolution/` · `product/` · `decisions/` · `research/` · `mikado/` · `refactor/` · `refactoring/`
>
> **Human-curated docs share the same root** (the rest of this index — `architecture/`, `domain/`, `api/`, `diagrams/`, `requirements/`, `guides/`, `infrastructure/`, `vision.md`, etc.). If the shared space becomes a problem, the plan is to carve out a separate human-owned root (e.g. `dev-docs/`) rather than fight nwave for `docs/`.

Dashboard Chat — a chat-first prototyping tool for data models and dashboards. Users go from raw files (or synthetic data) to working prototypes, then hand off dbt projects and renderable dashboard code to engineering teams.

## Product Vision

**[Read the full vision](vision.md)** — the prototyping workflow and handoff model

```
Upload files  ──►  Model with chat  ──►  Preview dashboard  ──►  Hand off dbt + dashboard code
  (complete)      (reports in progress)      (planned)              (dbt complete, dashboards planned)
```

## Contents

### Vision & Roadmap

- [Product Vision](vision.md) — Prototyping workflow, target users, healthcare/Synthea strategy, handoff model

### Architecture

High-level system design and service topology.

- [C4 Container Diagram](architecture/c4-containers.mermaid) — Services, handoff artifacts, and external integrations (incl. Synthea, planner)
- [Agent Topology](architecture/agent-topology.mermaid) — Chat worker context routing and tool execution
- [Auth Flow](architecture/auth-flow.mermaid) — Dev mode vs WorkOS authentication paths
- [Data Flow](architecture/data-flow.mermaid) — Upload through query with trust boundaries
- [Backend Layers](architecture/backend-layers.md) — Router → Controller → UseCase → Repository
- [Frontend Layers](architecture/frontend-layers.md) — Provider stack, chat engine, SSE protocol, tool execution, TanStack Query

### Domain

Core business concepts and data model.

- [Entity-Relationship Diagram](domain/erd.mermaid) — All 11 database tables with relationships
- [Dataset Lifecycle](domain/dataset-lifecycle.md) — Upload → transform → query pipeline
- [Tool Call Registry](domain/tool-calls/README.md) — All chat agent tools with parameter schemas (per-tool files)
- [Domain Entities](domain/entities/README.md) — Per-entity invariants, type systems, lifecycle rules, and authorization model

### API

- [Endpoints](api/endpoints.md) — REST endpoints across 12 routers + agent routes

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

- [Architecture Decision Records](decisions/README.md) — 12 ADRs in MADR format covering technology choices, LLM strategy, and healthcare positioning

### Requirements

- [Non-Functional Requirements](requirements/README.md) — Organized by prototyping workflow stages with Planguage + Quality Attribute Scenarios

### Contributing

- [CSS Modules Guide](guides/contributing-css-modules.md) — Domain-specific CSS naming conventions with Tailwind (for contributors to the frontend)

### Infrastructure

- [Docker Topology](infrastructure/docker-topology.mermaid) — Service graph with profiles and dependencies

## Related Resources

These resources live outside `docs/` but are integral to the project's documentation:

- **[Feature Specifications](../features/)** — 12 Gherkin feature files with 361 scenarios defining behavioral contracts
- **[OpenSpec](../openspec/)** — 94 specification directories covering all domains with structured change management
- **[CLAUDE.md](../CLAUDE.md)** — Developer workflow guide, conventions, and quick commands
- **[CHANGELOG.md](../CHANGELOG.md)** — Version history
