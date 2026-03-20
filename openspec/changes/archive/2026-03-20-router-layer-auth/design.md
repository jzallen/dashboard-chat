## Context

The backend currently handles both authentication and authorization in a layered but conflated way:

1. **AuthMiddleware** (`backend/app/auth/middleware.py`) validates Bearer tokens via the auth provider, enriches org_id from the DB, and sets `AuthUser` in a contextvar via `set_auth_user()`.
2. **Use cases** call `get_auth_user()` from the contextvar to get the current user, then delegate to `ProjectService._verify_org_access()` or `DatasetService._verify_org_access()` for org_id ownership checks.
3. **AuthorizationError** (`backend/app/auth/exceptions.py`) does not inherit `DomainException`, so it falls through to the generic 500 handler in `HTTPController._error_response()`.

The worker (`worker/lib/auth.ts`) independently implements the same token verification logic using `jose` + WorkOS JWKS.

The frontend injects Bearer tokens via `withAuth()` and proxies `/api/*` to the backend at `http://api:8000` through Vite's dev server proxy.

**Constraints:**
- Must support both dev mode (static token) and WorkOS mode (JWT/JWKS)
- Must not break existing frontend auth flow (token storage, refresh, withAuth)
- Backend must continue working standalone (without proxy) for tests
- Migration must be incremental — no big-bang rewrite

## Goals / Non-Goals

**Goals:**
- Separate authentication (token validation) from authorization (resource ownership) into distinct services/layers
- Auth proxy handles token validation — maps to API Gateway authorizer in cloud deployment
- FastAPI `Depends()` at router layer handles org_id authorization — proper HTTP semantics (401 vs 403)
- Use cases become pure business logic with no auth imports
- Fix AuthorizationError returning 500 instead of 403

**Non-Goals:**
- Role-based access control (RBAC) or fine-grained permissions — org_id ownership is sufficient for now
- Replacing the existing auth providers (DevAuthProvider, WorkOSAuthProvider) — they stay for login/callback/refresh flows
- Moving login/callback/refresh endpoints to the auth proxy — those remain on the backend
- Changing frontend token management or storage

## Decisions

### D1: Auth proxy as a separate Hono service

**Decision:** Create a new `auth-proxy/` service using Hono that validates Bearer tokens and forwards identity headers.

**Rationale:** The worker already has working Hono + jose + WorkOS JWKS verification code (`worker/lib/auth.ts`). A separate service cleanly maps to API Gateway authorizer pattern in production (AWS ALB + Lambda, Cloudflare Access). Keeping it separate from the backend means Python doesn't need to duplicate jose/JWKS logic.

**Alternatives considered:**
- *Nginx auth_request subrequest*: Would work but adds Nginx/Lua complexity and doesn't reuse existing TypeScript verification code.
- *Keep in backend middleware*: Doesn't map to cloud API Gateway pattern and keeps token validation coupled to the Python backend.

### D2: Trusted headers for identity forwarding

**Decision:** Auth proxy sets `X-User-Id`, `X-Org-Id`, `X-User-Email` headers after successful token validation. Backend reads these headers via FastAPI `Depends()`.

**Rationale:** This is the standard pattern for reverse proxy → backend communication (AWS ALB, Cloudflare Access, Envoy). Headers are simple, stateless, and don't require shared session stores.

**Security:** Backend must only trust these headers when the request comes from the auth proxy, not directly from clients. In Docker Compose, this is enforced by network topology (frontend proxy → auth-proxy → backend). In production, the API Gateway guarantees this. Backend should NOT accept these headers when running standalone (test mode) — fall back to contextvar.

### D3: FastAPI Depends() for authorization at router layer

**Decision:** Add `get_current_user()`, `authorize_project_access()`, `authorize_dataset_access()` as FastAPI dependency functions in `backend/app/routers/deps.py`.

**Rationale:** FastAPI's dependency injection is the idiomatic way to handle cross-cutting concerns at the routing layer. It runs before the controller/use-case, returns proper HTTP errors (403), and is easily testable via `app.dependency_overrides`.

**Pattern:**
```python
# deps.py
async def get_current_user(request: Request) -> AuthUser:
    """Read user identity from proxy headers, fall back to contextvar."""
    user_id = request.headers.get("X-User-Id")
    if user_id:
        return AuthUser(
            id=user_id,
            org_id=request.headers.get("X-Org-Id"),
            email=request.headers.get("X-User-Email", ""),
        )
    # Fallback for direct access (tests, standalone mode)
    return get_auth_user()

async def authorize_project_access(
    project_id: str,
    user: AuthUser = Depends(get_current_user),
    db: AsyncSession = Depends(use_db_context),
) -> tuple[AuthUser, dict]:
    """Verify user's org owns the project. Returns (user, project_dict)."""
    project = await metadata_repo.get_project(project_id)
    if not project:
        raise ProjectNotFound(project_id)
    if project.get("org_id") and project["org_id"] != user.org_id:
        raise AuthorizationError(f"Access denied to project {project_id}")
    return user, project
```

### D4: Global exception handler for AuthorizationError

**Decision:** Register a FastAPI exception handler in `main.py` that catches `AuthorizationError` and returns 403 with JSON:API error format.

**Rationale:** Currently `AuthorizationError` doesn't inherit `DomainException`, so `_error_response()` in `HTTPController` treats it as an unhandled exception → 500. A global exception handler is simpler than making `AuthorizationError` inherit `DomainException` (which would change the error shape contract) and catches authorization errors regardless of where they originate.

```python
@app.exception_handler(AuthorizationError)
async def authorization_error_handler(request, exc):
    return JSONResponse(
        status_code=403,
        content=wrap_jsonapi_error(403, "Forbidden", str(exc)),
    )
```

### D5: Domain-by-domain migration strategy

**Decision:** Migrate use cases incrementally: projects → datasets → views → reports → sql_access → uploads.

**Rationale:** Projects are the most referenced domain (all other domains check project ownership). Migrating projects first establishes the pattern. Each domain can be migrated, tested, and merged independently.

**Migration pattern per use case:**
1. Add `user: AuthUser` parameter to use case function signature
2. Remove `get_auth_user()` call from use case body
3. Remove `ProjectService.fetch_and_authorize_project()` call (auth moved to router)
4. Add `Depends(authorize_project_access)` to the corresponding router endpoint
5. Update tests to pass `user` directly instead of calling `set_auth_user()`

### D6: Auth proxy dev mode

**Decision:** In dev mode (`AUTH_MODE=dev`), the auth proxy accepts the static `dev-token-static` token and forwards hardcoded dev user headers without WorkOS verification.

**Rationale:** Matches existing dev mode behavior in both backend and worker. Developers don't need WorkOS credentials for local development.

## Risks / Trade-offs

**[Risk] Backend accepts forged headers in standalone mode** → Mitigated by: Backend only reads proxy headers in `get_current_user()` as a primary source when a config flag (`TRUST_PROXY_HEADERS=true`) is set. Default is false (contextvar-only). Docker Compose sets this flag for the backend service.

**[Risk] Auth proxy adds latency to every request** → Mitigated by: JWKS is cached by `jose`'s `createRemoteJWKSet()` (same as current worker). Token validation is a local crypto operation (~1ms). Network hop within Docker is sub-millisecond.

**[Risk] Migration breaks tests that rely on contextvar setup** → Mitigated by: `get_current_user()` falls back to contextvar when proxy headers aren't present. Tests continue working with `set_auth_user()` during migration. After full migration, tests pass `user` directly.

**[Risk] Two services (worker + auth-proxy) with duplicated JWKS code** → Mitigated by: Extract shared token verification into a package in `shared/auth/` (future improvement). For now, the auth proxy code is <50 lines — duplication is acceptable.

**[Trade-off] Login/callback/refresh stay on backend, not proxy** → The auth proxy only handles stateless token validation. Login flows require WorkOS API keys and database access (user provisioning, org enrichment) which belong in the backend. This means the auth proxy skips `/api/auth/*` paths.

## Migration Plan

### Phase 1: Foundation (non-breaking)
1. Create auth proxy service with dev + WorkOS modes
2. Add `AuthorizationError` exception handler to `main.py` (fixes 500→403)
3. Add `get_current_user()` and authorization dependencies to `deps.py`
4. Wire auth proxy into Docker Compose (frontend → auth-proxy → backend)
5. Add `TRUST_PROXY_HEADERS` config to backend settings

### Phase 2: Domain migration (incremental)
6. Migrate project use cases (reference implementation)
7. Migrate dataset use cases
8. Migrate view use cases
9. Migrate report use cases
10. Migrate sql_access use cases
11. Migrate upload use cases (fixes missing auth on `create_dataset_from_upload`)

### Phase 3: Cleanup
12. Remove `ProjectService._verify_org_access()` and `DatasetService._verify_org_access()`
13. Remove `get_auth_user()` imports from migrated use cases
14. Simplify `AuthMiddleware` to trust proxy headers (optional — can keep as defense-in-depth)

**Rollback:** Each phase is independently deployable. Auth proxy can be removed from Docker Compose to revert to direct frontend→backend routing. Use case changes are backward-compatible during migration (contextvar fallback).

## Open Questions

- Should `shared/auth/` be created now to share token verification between worker and auth-proxy, or defer until a third consumer needs it?
- Should the auth proxy also front the worker's chat endpoints, or keep worker auth independent for now?
