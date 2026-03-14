## Why

Authentication (token validation) and authorization (resource ownership) are conflated inside use cases. `AuthMiddleware` validates tokens, but org_id ownership checks are scattered across ~20 use cases via `ProjectService.fetch_and_authorize_project()` and inline `get_auth_user()` calls. This causes `AuthorizationError` to return 500 instead of 403, leaves gaps like `create_dataset_from_upload` missing org_id verification, and doesn't map to cloud deployment where an API Gateway handles token validation before requests reach the backend.

## What Changes

- **Add auth proxy service**: Lightweight Hono service that validates Bearer tokens and forwards identity as trusted headers (`X-User-Id`, `X-Org-Id`, `X-User-Email`). Reuses existing WorkOS token verification from the worker. In dev mode, passes through dev tokens without verification.
- **Add FastAPI authorization dependencies**: `get_current_user()`, `authorize_project_access()`, `authorize_dataset_access()` as `Depends()` functions in `backend/app/routers/deps.py`. Backend reads user identity from proxy headers with contextvar fallback.
- **Add global AuthorizationError handler**: Exception handler in `main.py` that returns 403 instead of current 500 behavior.
- **Migrate use cases to pure business logic**: Remove `get_auth_user()` calls from use cases. Accept `user: AuthUser` as explicit parameter. Domain-by-domain: projects → datasets → views → reports → sql_access → uploads.
- **Remove scattered auth from services**: Delete `ProjectService._verify_org_access()`, `DatasetService._verify_org_access()`, and related inline checks after migration.
- **Rewire Docker Compose networking**: Auth proxy sits between frontend/Vite proxy and backend. Frontend proxy target changes from `api:8000` to `auth-proxy:3000`.

## Capabilities

### New Capabilities
- `auth-proxy`: Stateless token validation proxy that sits between frontend and backend, validates Bearer tokens via WorkOS JWKS or dev passthrough, and forwards identity as trusted HTTP headers
- `router-layer-authorization`: FastAPI `Depends()` functions at the router layer that enforce resource ownership (org_id checks) before use cases execute, with global exception handler for proper 403 responses

### Modified Capabilities
- `auth-context-decomposition`: Backend auth context shifts from middleware-set contextvar to proxy-header-based identity extraction, with contextvar as fallback during migration
- `auth-fetch-decorator`: Frontend `withAuth()` continues to inject Bearer tokens, but target changes from backend to auth proxy

## Impact

- **New service**: `auth-proxy/` directory with Hono app, Dockerfile, and tests
- **Docker Compose**: New service definition, frontend proxy target rewired
- **Frontend**: `vite.config.ts` proxy target changes
- **Backend routers**: All route handlers gain `Depends()` for authorization
- **Backend use cases**: ~20 files lose `get_auth_user()` calls, gain `user: AuthUser` parameter
- **Backend services**: `ProjectService` and `DatasetService` lose `_verify_org_access()` methods
- **Backend main.py**: New exception handler registration
- **Tests**: Auth setup simplifies (pass user directly instead of setting context vars)
