# ADR-010: Bazel over Pure Turborepo for Build Orchestration

## Status

Accepted

## Context and Problem Statement

The monorepo contains Python (backend), TypeScript (frontend, agent, auth-proxy), and shared configs. Builds need to be reproducible and cacheable across languages, while JavaScript-specific tasks still benefit from npm workspace orchestration.

## Decision Drivers

- Hermetic, reproducible builds across Python and TypeScript
- Cross-language dependency tracking in a single build graph
- Docker image generation as build artifacts
- npm workspace task orchestration for JavaScript-specific workflows

## Considered Options

1. **Bazel as primary build system, with Turborepo for JS tasks** (selected)
2. **Pure Turborepo**

### Option 1: Bazel + Turborepo

- Good, because Bazel provides hermetic builds and cross-language dependency tracking
- Good, because Bazel handles Docker image generation (`dashboard-chat/*:bazel` images) reproducibly
- Good, because Turborepo handles npm workspace tasks (`test`, `build`, `dev`) where Bazel's overhead isn't justified
- Bad, because two build systems must be maintained in parallel

### Option 2: Pure Turborepo

- Good, because it provides a single, simpler build system
- Good, because it integrates natively with npm workspaces
- Bad, because it only supports JavaScript/TypeScript, leaving Python builds unmanaged
- Bad, because it lacks hermetic build guarantees and cross-language dependency tracking
- Bad, because Docker image generation is not a native capability

## Decision Outcome

Chosen option: **Bazel + Turborepo**, because Bazel provides hermetic cross-language builds and Docker image generation, while Turborepo handles JavaScript task orchestration where Bazel's overhead is unnecessary.

### Consequences

- **Good:** `BUILD.bazel` and `MODULE.bazel` define Bazel targets for reproducible builds and Docker images. `turbo.json` defines JS pipeline tasks for development workflows
- **Bad:** Two build systems to maintain. Default-profile Docker images are built by Bazel for reproducibility, while the optional `api-full` service uses a traditional Dockerfile for hot-reload development

## Confirmation

Verify that Bazel builds produce identical Docker images across environments. Confirm that Turborepo correctly orchestrates JS tasks (`test`, `build`, `dev`) within npm workspaces.

## Related

- [ADR-001: Hono over Express for Chat Worker](adr-001-hono-over-express.md) -- Bazel builds the Hono-based worker
