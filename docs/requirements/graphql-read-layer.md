# GraphQL Read Layer (CQRS Read/Write Separation)

## Status: Backlog (Future Consideration)

## Problem
Read queries dominate API traffic and use `selectinload` chains that issue multiple SQL queries per request. As the data model grows (Projects → Datasets → Transforms → future entities), the N+1 problem compounds.

## Proposed Solution
Separate read operations (GraphQL) from write operations (existing REST/SQLAlchemy).

## Evaluation Summary

### Options Evaluated

| Option | SQLite Dev | Migration Effort | Auth Fit | Verdict |
|--------|-----------|-----------------|----------|---------|
| **Strawberry GraphQL** | YES | Medium | Easy (shares middleware) | Best fit |
| Hasura | NO (PostgreSQL-only) | Low | Good (JWT claims) | Eliminated |
| PostGraphile | NO (PostgreSQL-only) | Low | Medium (RLS) | Eliminated |
| **CQRS-Lite (SQL views)** | YES | Low | None needed | Interim step |

### Recommended Path

#### Phase 1: CQRS-Lite (Near-term, before GraphQL)
Replace `selectinload` chains with pre-joined SQL views or flattened repository queries:
- `project_with_datasets_view` — single JOIN, returns projects with embedded dataset summaries
- `dataset_with_transforms_view` — single JOIN, returns datasets with transform metadata
- Works with SQLite (regular views) and PostgreSQL (materialized views)
- Zero new dependencies, zero new infrastructure

#### Phase 2: Strawberry GraphQL (When flexible field selection is needed)
Mount alongside REST:
```python
from strawberry.fastapi import GraphQLRouter
schema = strawberry.Schema(query=Query)
app.include_router(GraphQLRouter(schema), prefix="/graphql")
```

Key patterns:
- **DataLoaders** for batching N+1 into `WHERE ... IN (...)` queries
- Share auth via `get_context()` → reuse existing `AuthUser` from middleware
- Keep all POST/PATCH/DELETE as REST — only reads via GraphQL
- Frontend uses `graphql-request` or `urql` for read queries

### Prerequisites
- Current optimizations (FK indexes, projection, joinedload) should be applied first ✅
- Keyset pagination should be implemented first (simplifies GraphQL resolver design)
- Team should have a concrete use case for flexible field selection before adopting GraphQL

### Risks
- Dual paradigm (REST + GraphQL) increases cognitive load for 1-3 person team
- Schema divergence between REST response types and GraphQL types during migration
- DataLoader boilerplate for each relationship

### Decision Criteria
Adopt GraphQL when:
1. Frontend frequently requests different subsets of fields from the same entity
2. Multiple frontend views need different relationship depth (list view vs detail view vs export)
3. The `include_transforms` / `include_datasets` query param pattern proliferates beyond 2-3 endpoints
