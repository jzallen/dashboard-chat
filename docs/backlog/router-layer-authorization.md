# Hybrid Auth Architecture — Auth Proxy + Router-Layer Authorization

## Context

Authentication (token validation) and authorization (resource ownership / org_id checks) are currently conflated inside use cases. `AuthMiddleware` handles token validation, but org_id ownership checks are scattered across ~20 use cases via `ProjectService.fetch_and_authorize_project()` and inline `get_auth_user()` calls.

This creates several problems:

1. **Auth logic mixed with business logic** — use cases contain authorization concerns that belong at the routing layer
2. **Wrong HTTP status codes** — `AuthorizationError` raised inside use cases returns 500 instead of 403, because it's caught by the generic exception handler rather than a dedicated auth handler
3. **Missing authorization** — `create_dataset_from_upload` lacks org_id verification (see `upload-org-id-authorization.md`)
4. **Architecture mismatch** — the current design doesn't map to cloud deployment where an API Gateway handles token validation before requests reach the backend

## Target Architecture

### Auth Proxy (Workstream A)

A lightweight Hono service that sits between the frontend and backend:

- Validates Bearer tokens using WorkOS JWKS (reuses existing worker token verification logic)
- Forwards identity as trusted headers: `X-User-Id`, `X-Org-Id`, `X-User-Email`
- Rejects invalid tokens with 401 before requests reach the backend
- In dev mode, passes through dev tokens without WorkOS verification
- Maps directly to an API Gateway authorizer in production (e.g., AWS ALB + Lambda authorizer, Cloudflare Access)

### Router-Layer Authorization (Workstream B)

FastAPI `Depends()` functions at the router layer handle resource ownership:

- `get_current_user()` — reads identity from proxy headers (or contextvar fallback)
- `authorize_project_access(project_id, user)` — verifies org_id ownership
- `authorize_dataset_access(dataset_id, user)` — verifies org_id ownership via project
- Global `AuthorizationError` exception handler returns proper 403 responses
- Use cases become pure business logic, accepting `user: AuthUser` as an explicit parameter

## Benefits

- **Separation of concerns**: authentication (proxy) vs authorization (router) vs business logic (use cases)
- **Correct HTTP semantics**: 401 for bad tokens (proxy), 403 for unauthorized access (router)
- **Cloud-ready**: auth proxy maps to API Gateway authorizer pattern
- **Testability**: use cases can be tested without auth context setup
- **Consistency**: authorization enforced uniformly at the routing boundary

## Migration Strategy

Domain-by-domain migration to avoid big-bang rewrite:
1. Projects (reference implementation)
2. Datasets
3. Views
4. Reports
5. SQL access
6. Uploads

## Files to Modify

**New service:**
- `auth-proxy/` — Hono service for token validation
- `docker-compose.yml` — add auth-proxy, rewire frontend proxy target

**Backend:**
- `backend/app/routers/deps.py` — add auth dependency functions
- `backend/app/auth/middleware.py` — simplify to trust proxy headers
- `backend/app/main.py` — add AuthorizationError exception handler
- `backend/app/use_cases/project/project_service.py` — remove `_verify_org_access`
- `backend/app/routers/*.py` — add `Depends()` for authorization
- `backend/app/use_cases/*/` — remove `get_auth_user()` calls, accept `user` parameter
