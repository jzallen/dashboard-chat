## 1. Foundation — Auth Proxy Service

- [x] 1.1 Create `auth-proxy/` directory with `package.json`, `tsconfig.json`, and Hono dependency
- [x] 1.2 Implement auth proxy Hono app: public path passthrough, dev mode token check, WorkOS JWT verification via `jose` JWKS
- [x] 1.3 Implement request proxying: forward authenticated requests to `BACKEND_URL` with `X-User-Id`, `X-Org-Id`, `X-User-Email` headers; strip client-supplied identity headers
- [x] 1.4 Add `/health` endpoint returning `{"status": "ok"}`
- [x] 1.5 Add auth proxy tests: valid token forwarding, invalid token rejection, dev mode, public path passthrough, header stripping
- [x] 1.6 Create `auth-proxy/Dockerfile` for containerized deployment

## 2. Foundation — Docker Compose & Frontend Proxy

- [x] 2.1 Add `auth-proxy` service to `docker-compose.yml` with `AUTH_MODE`, `WORKOS_CLIENT_ID`, `BACKEND_URL` env vars
- [x] 2.2 Update `frontend/vite.config.ts` proxy target from `http://api:8000` to `http://auth-proxy:3000` for `/api` and `/health`
- [x] 2.3 Verify frontend → auth-proxy → backend request flow works end-to-end in Docker Compose

## 3. Foundation — Backend Authorization Infrastructure

- [x] 3.1 Add `TRUST_PROXY_HEADERS` setting to `backend/app/config.py` (default: `false`)
- [x] 3.2 Set `TRUST_PROXY_HEADERS=true` in `docker-compose.yml` for the `api` service
- [x] 3.3 Add `get_current_user()` dependency to `backend/app/routers/deps.py`: read from proxy headers when `TRUST_PROXY_HEADERS` is true, fall back to contextvar
- [x] 3.4 Add `authorize_project_access()` dependency to `deps.py`: fetch project, verify org_id ownership, return `(user, project_dict)`
- [x] 3.5 Add `authorize_dataset_access()` dependency to `deps.py`: fetch dataset, verify org_id via parent project, return `(user, dataset_dict)`
- [x] 3.6 Register global `AuthorizationError` exception handler in `backend/app/main.py` returning 403 with JSON:API error format
- [x] 3.7 Update `AuthMiddleware` to trust proxy headers when `TRUST_PROXY_HEADERS` is true (skip token verification, construct `AuthUser` from headers)
- [x] 3.8 Add tests for `get_current_user()`, `authorize_project_access()`, and the 403 exception handler

## 4. Domain Migration — Projects

- [x] 4.1 Add `Depends(get_current_user)` or `Depends(authorize_project_access)` to project router endpoints in `backend/app/routers/projects.py`
- [x] 4.2 Update `get_project` use case: accept `user: AuthUser` parameter, remove `get_auth_user()` call and `fetch_and_authorize_project()` (auth handled by router)
- [x] 4.3 Update `list_projects` use case: accept `user: AuthUser` parameter, remove `get_auth_user()` call
- [x] 4.4 Update `create_project` use case: accept `user: AuthUser` parameter, remove `get_auth_user()` call
- [x] 4.5 Update `update_project` use case: accept `user: AuthUser` parameter, remove `get_auth_user()` and `fetch_and_authorize_project()` calls
- [x] 4.6 Update `delete_project` use case: accept `user: AuthUser` parameter, remove `get_auth_user()` and `fetch_and_authorize_project()` calls
- [x] 4.7 Update project controller methods to pass user from router dependency to use cases
- [x] 4.8 Update project use case tests: pass `user` directly instead of calling `set_auth_user()`

## 5. Domain Migration — Datasets

- [x] 5.1 Add `Depends(authorize_project_access)` or `Depends(authorize_dataset_access)` to dataset router endpoints
- [x] 5.2 Update dataset use cases (`get_dataset`, `list_datasets`, `create_dataset`, `update_dataset`, `delete_dataset`): accept `user: AuthUser`, remove `get_auth_user()` calls
- [x] 5.3 Update `create_dataset_from_upload` use case: add org_id authorization (fixes missing auth gap)
- [x] 5.4 Update dataset controller methods and tests

## 6. Domain Migration — Views, Reports, SQL Access, Uploads

- [x] 6.1 Add authorization dependencies to view router endpoints and update view use cases
- [x] 6.2 Add authorization dependencies to report router endpoints and update report use cases
- [x] 6.3 Add authorization dependencies to sql_access router endpoints and update sql_access use cases
- [x] 6.4 Add authorization dependencies to upload router endpoints and update upload use cases
- [x] 6.5 Update all affected controller methods and tests

## 7. Cleanup

- [x] 7.1 Remove `ProjectService._verify_org_access()` and `DatasetService._verify_org_access()` methods
- [x] 7.2 Remove unused `get_auth_user()` imports from migrated use cases
- [x] 7.3 Verify all backend tests pass with new auth pattern
- [x] 7.4 Run e2e tests to verify full flow: frontend → auth-proxy → backend
