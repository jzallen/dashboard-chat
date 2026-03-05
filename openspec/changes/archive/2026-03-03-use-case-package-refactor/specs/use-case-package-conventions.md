# Capability: Use Case Package Conventions

**Status**: ADDED
**Domain**: backend

## Overview

A standardized package structure for all use case domains, codifying the patterns established by the sql_access refactor. Every domain follows the same layout conventions for readability, discoverability, and consistency.

## Behaviors

### Package Structure Convention

- Every use case domain is a Python package (directory with `__init__.py`), never a flat module
- Use case functions live at the package top level, one function per file, file named identically to the function
- Each use case function has the `@with_repositories` (outer) + `@handle_returns` (inner) decorator stack
- `__init__.py` exports only public use case functions via an explicit `__all__` list
- Service modules (`{domain}_service.py`) contain shared logic used by 2+ use cases and are NOT exported in `__init__.py`
- Domain-private constants and types live in underscore-prefixed modules (`_{name}.py`)

### Subpackage Convention

- Supporting code (infrastructure, I/O, pipelines, generators) lives in underscore-prefixed subpackages (`_infra/`, `_pipeline/`, `_dbt/`)
- The underscore prefix signals "internal implementation detail — not part of the domain's public API"
- Subpackage `__init__.py` re-exports all public symbols via `__all__` for flat access within the domain
- Use cases import from the subpackage top level (e.g., `from ._pipeline import analyze_dataframe`), never from internal modules directly

### Exception Convention

- Each domain has its own `exceptions.py` module defining domain-specific exception classes
- All domain exceptions inherit from `DomainException` (imported from `app.use_cases.exceptions`)
- The shared `app/use_cases/exceptions.py` contains only `DomainException` base class and cross-cutting exceptions like `AuthorizationError`
- Domain exception modules are NOT exported in the domain's `__init__.py`

### Authorization Convention

- Use cases that operate on org-scoped resources must verify `resource.org_id == user.org_id`
- Authorization checks are centralized in the domain's service module (e.g., `DatasetService._verify_org_access`, `ProjectService.fetch_and_authorize_project`)
- Use cases delegate to the service for auth — they do not implement inline auth checks

## Constraints

- A domain package must never import use case functions from another domain package (cross-domain calls go through controllers or are restructured as shared services)
- Private helpers that are used by only one use case stay in that use case's file (prefix `_`), not extracted to a service or subpackage
- The service module is reserved for logic shared by 2+ use cases within the domain — do not create a service for single-use helpers
