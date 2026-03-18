# Keyset Pagination for List Endpoints

## Status: Backlog

## Problem
`list_projects` and `list_datasets` return all records without pagination. At scale (100+ projects, 1000+ datasets), this becomes a performance and UX bottleneck.

## Proposed Solution
Keyset (cursor-based) pagination using UUIDv7 `id` as the sole cursor column.

### Why Keyset Over Offset
- UUIDv7 IDs are time-ordered and unique — `id DESC` gives the same order as `created_at DESC` with zero ambiguity
- O(1) performance at any depth (no scan+skip like OFFSET)
- Stable under concurrent writes (no page drift)
- Natural fit for TanStack Query's `useInfiniteQuery` on the frontend

### Implementation Sketch

**Cursor encode/decode** (~5 lines):
```python
import base64, json

def encode_cursor(record_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps({"id": record_id}).encode()).decode()

def decode_cursor(cursor: str) -> str:
    return json.loads(base64.urlsafe_b64decode(cursor))["id"]
```

**Repository** (add `cursor`/`limit` params):
```python
async def list_projects(self, org_id=None, cursor=None, limit=20):
    query = select(ProjectRecord).options(...)
    if org_id: query = query.where(ProjectRecord.org_id == org_id)
    if cursor: query = query.where(ProjectRecord.id < decode_cursor(cursor))
    query = query.order_by(ProjectRecord.id.desc()).limit(limit + 1)
    rows = (await self._session.execute(query)).scalars().all()
    has_more = len(rows) > limit
    page = rows[:limit]
    next_cursor = encode_cursor(page[-1].id) if has_more else None
    return page, next_cursor
```

**Response envelope**:
```json
{
  "success": true,
  "data": [...],
  "pagination": { "next_cursor": "...", "has_more": true, "page_size": 20 }
}
```

### Files to Change
- `backend/app/repositories/metadata/repository.py` — add cursor/limit to `list_projects`, `list_datasets`
- `backend/app/use_cases/project/list_projects.py` — pass through pagination params
- `backend/app/use_cases/dataset/list_datasets.py` — same
- `backend/app/controllers/http_controller.py` — build paginated envelope
- `backend/app/controllers/response_wrapper.py` — add `wrap_paginated()` helper
- `backend/app/routers/projects.py`, `datasets.py` — accept `cursor`/`per_page` query params
- Frontend: migrate relevant queries to `useInfiniteQuery`

### Libraries Evaluated
- `fastapi-pagination` — mature but imposes its own response envelope, conflicts with existing `{"success": true, "data": [...]}` wrapper
- `sqlakeyset` — overkill for single-column UUIDv7 cursor
- **Hand-rolled** (recommended) — ~20 lines, full control, no new dependency

### Notes
- Works with both SQLite and PostgreSQL
- `selectinload` is fully compatible with cursor pagination
- Optional `?include_count=true` param for total count on initial load
