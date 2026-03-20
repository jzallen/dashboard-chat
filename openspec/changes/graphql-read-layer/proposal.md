## Why

The current REST API requires separate round-trips for projects, datasets, and views. A GraphQL read layer lets clients fetch exactly the shape they need in one request, enables the frontend to co-locate data requirements with components, and opens the door to real-time subscriptions for dataset state changes without polling.

## What Changes

- Add a GraphQL endpoint (`/graphql`) to the FastAPI backend, read-only (queries + subscriptions only; mutations stay on REST)
- Expose the core resource graph: `Organization → Projects → Datasets → Views → Reports`
- Schema types mirror existing REST response models; resolvers delegate to existing use cases
- Subscriptions for dataset processing status (upload → processing → ready) via WebSocket
- Auth: same Bearer token / proxy header auth as REST; org_id scoping enforced at resolver level

## Capabilities

### New Capabilities
- `graphql-schema`: Type definitions for Organization, Project, Dataset, View, Report and their relationships
- `graphql-resolvers`: Query resolvers delegating to existing use cases with org_id enforcement
- `graphql-subscriptions`: WebSocket subscription for dataset processing status events

### Modified Capabilities
- `router-layer-authorization`: GraphQL endpoint must participate in the same auth proxy / dependency injection pattern as REST routers

## Impact

- `backend/app/routers/graphql.py` — new router mounted at `/graphql`
- `backend/app/main.py` — mount GraphQL router and WebSocket handler
- `backend/pyproject.toml` — add `strawberry-graphql[fastapi]` or equivalent
- `backend/tests/` — new `tests/graphql/` suite
- Frontend: optional — REST client remains; GraphQL client added alongside for components that benefit
- No existing REST routes modified or removed
