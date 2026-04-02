## Why

The outbox pattern is used across the backend but has no unified processing layer. Today there are two independent consumption paths: a dedicated `sync_processor.py` background task that polls for query engine sync events, and inline processing in `create_project.py` for `ProjectCreated` events. As the system grows (mart materialization, analytics extract generation, webhook delivery), each new event type would require either bolting onto the sync processor or adding another ad-hoc consumer. A general-purpose outbox dispatcher provides a single poll loop with pluggable handlers, eliminating duplication and giving every event type the same retry, backoff, and observability guarantees.

## What Changes

- **New generic dispatcher** that replaces the sync processor's poll loop. One background `asyncio` task polls the outbox, deserializes events, and routes them to registered handler functions by event type.
- **Handler registry** — each event type maps to a handler (async callable). Existing sync event handlers (`_process_dataset_sync`, `_process_transform_sync`, `_process_dataset_removed`) become registered handlers. `ProjectCreated` processing moves from inline to async dispatch.
- **Shared retry/backoff infrastructure** — the exponential backoff logic currently in `sync_processor.py` becomes the dispatcher's responsibility, applied uniformly to all event types.
- **Handler-level configuration** — handlers can declare concurrency limits, batch size, and priority so workload isolation is possible without separate processes.
- **`sync_processor.py` is removed** — its handlers are extracted and registered with the dispatcher. The background task in `main.py` starts the dispatcher instead.
- **`ProjectCreated` moves to async dispatch** — currently consumed synchronously in the request path. Moving it to the dispatcher makes it consistent with all other events and tolerant of downstream failures (Stream API outage doesn't block project creation). **BREAKING** for the current inline consumption path, but the outbox record already exists — the dispatcher just picks it up.

## Capabilities

### New Capabilities
- `outbox-dispatcher`: Generic event dispatcher with handler registry, poll loop, retry/backoff, and per-handler configuration. Replaces the single-purpose sync processor.

### Modified Capabilities
- `project-memory-outbox`: `ProjectCreated` events move from synchronous inline consumption to async dispatch via the outbox dispatcher. The provisioning behavior is unchanged but the timing shifts from "during request" to "within seconds after request."
- `query-engine`: Sync event processing (DatasetSyncRequested, TransformSyncRequested, DatasetRemoved) moves from the dedicated sync processor to registered handlers in the outbox dispatcher. Behavior is unchanged — only the hosting/lifecycle changes.

## Impact

- **Backend startup** (`main.py`): Replace `run_sync_processor()` task with dispatcher startup. Handler registration happens during app lifespan.
- **`use_cases/query_engine/sync_processor.py`**: Removed. Handler functions extracted to a handlers module and registered with the dispatcher.
- **`use_cases/project/create_project.py`**: Remove inline `provision_project_memory` call. The dispatcher handles `ProjectCreated` asynchronously.
- **`use_cases/project/provision_project_memory.py`**: Becomes a registered handler for `ProjectCreated` events.
- **`repositories/outbox/repository.py`**: `get_unprocessed_sync_events()` generalizes to `get_unprocessed()` with optional event type filtering. Existing method may be kept as a convenience wrapper.
- **Tests**: Sync processor tests refactored to test handlers in isolation + dispatcher integration tests for routing, retry, and backoff.
- **No API changes** — the dispatcher is an internal infrastructure change. No frontend impact.
- **No new dependencies** — uses asyncio, the existing outbox table, and existing handler logic.
