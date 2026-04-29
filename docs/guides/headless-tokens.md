# Issue, use, and revoke a headless token

This guide walks you through obtaining a non-interactive bearer credential
for Dashboard Chat — a **PAT** (Personal Access Token) for user-bound
automation, or an **M2M client_credentials** token for service-to-service
calls.

Both flows are minted by the [auth-proxy](../../auth-proxy/README.md) and
validated through the same JWT path the proxy uses for browser-issued
WorkOS sessions. Backend and worker do not need to know whether a request
arrived as a user JWT, a PAT, or an M2M token — all three resolve to the
same `X-User-Id` / `X-Org-Id` / `X-User-Email` identity headers.

> **Audience:** partners and operators who need to drive Dashboard Chat
> from a CLI, CI pipeline, or service. If you're looking for the
> interactive (browser) login flow, see
> [ADR-016](../decisions/adr-016-auth-proxy-in-test-stack.md).

## Prerequisites

| You need | Why |
|----------|-----|
| `M2M_ENABLED=true` on the auth-proxy | Both PAT and M2M endpoints are gated behind this flag. Disabled by default. |
| **For PATs:** an active user JWT | PATs may only be minted by a real interactive user — a PAT cannot mint another PAT. |
| **For M2M (prod):** a configured `M2M_CLIENTS` entry | Production deployments inject service credentials via secrets manager. |
| **For M2M (dev):** nothing extra | Auth-proxy ships with a built-in `dev-m2m-client` / `dev-m2m-secret` pair when `AUTH_MODE=dev`. |

The token shape and dev/prod surface match exactly — what you build
locally against `AUTH_MODE=dev` is what runs in production. Dev tokens
are visually distinguishable so you can tell them apart in logs and
alerts:

| Mode  | M2M `kid`           | PAT `kid`           | PAT id prefix |
|-------|---------------------|---------------------|---------------|
| dev   | `auth-proxy:m2m:1`  | `auth-proxy:pat:1`  | `dev-pat-…`   |
| prod  | `auth-proxy:m2m:1`  | `auth-proxy:pat:1`  | `pat_…`       |

---

## Choose your flow

| Flow | Use it when… |
|------|--------------|
| **PAT** (Personal Access Token) | A specific user owns the automation and revocation should follow that user (e.g., a developer's CLI, a one-off script). |
| **M2M** (OAuth2 client_credentials) | A service account owns the automation, decoupled from any individual user (e.g., an ingest job, a partner integration). |

Both flows produce a Bearer token. Pass it in `Authorization: Bearer <token>` to any
auth-proxy route to act on the system.

---

## Flow A — PAT (Personal Access Token)

### 1. Issue

`POST /api/auth/pats` with your interactive user JWT in the
`Authorization` header. The token is returned **once** — it is not
stored in plaintext and cannot be retrieved later.

#### Dev mode

```bash
# 1. Get a user JWT — in dev, the static dev token is acceptable to backend's
#    JWKS path; in production, finish the WorkOS browser login first.
USER_JWT="dev-token-static"

# 2. Mint a PAT.
curl -X POST http://localhost:3000/api/auth/pats \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-cli","expires_in_seconds":2592000}'
```

Response (`201 Created`):

```json
{
  "id": "dev-pat-58a17d...",
  "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImF1dGgtcHJveHk6cGF0OjEi...",
  "name": "my-cli",
  "created_at": "2026-04-29T20:30:11.000Z",
  "expires_at": "2026-05-29T20:30:11.000Z"
}
```

#### Production mode

```bash
USER_JWT="<paste your WorkOS-issued session JWT>"

curl -X POST https://auth-proxy.example.com/api/auth/pats \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-runner"}'
```

Omit `expires_in_seconds` for a long-lived PAT. Issuance refuses any
Bearer that is itself a PAT or an M2M token (returns `403`) — only a real
user JWT can mint a PAT.

> **Production deployments must persist the auth-proxy signing keypair**
> by setting `AUTH_PROXY_KEYPAIR_PATH`. Without it, every auth-proxy
> restart rotates the keypair and silently invalidates every issued PAT
> regardless of `expires_in_seconds`. See
> [auth-proxy/README.md](../../auth-proxy/README.md#keypair-persistence)
> for the full setup.

### 2. Use

Pass the issued `token` as a Bearer to any auth-proxy route. Auth-proxy
validates the signature and consults its PAT store for the token's `jti`,
so a revoked PAT stops working immediately.

```bash
PAT="<token from step 1>"

curl -H "Authorization: Bearer $PAT" \
     http://localhost:3000/api/projects        # dev
# or
curl -H "Authorization: Bearer $PAT" \
     https://auth-proxy.example.com/api/projects  # prod
```

### 3. List your PATs

`GET /api/auth/pats` returns the caller's PATs. Token material is **not**
returned — only id, name, timestamps, and `revoked_at`.

```bash
curl -H "Authorization: Bearer $USER_JWT" \
     http://localhost:3000/api/auth/pats
```

### 4. Revoke

`DELETE /api/auth/pats/{id}` revokes immediately. Subsequent calls with
the revoked token return `401`.

```bash
curl -X DELETE \
     -H "Authorization: Bearer $USER_JWT" \
     http://localhost:3000/api/auth/pats/dev-pat-58a17d...
```

Returns `204 No Content` on success, `404` if the id is unknown, already
revoked, or belongs to another user (the same `404` for "not yours" and
"doesn't exist" is intentional — it does not leak the existence of other
users' PAT ids).

---

## Flow B — M2M (client_credentials)

### 1. Mint a token

`POST /api/auth/token` with an OAuth2 `client_credentials` grant.

#### Dev mode (built-in client)

```bash
curl -X POST http://localhost:3000/api/auth/token \
  -d grant_type=client_credentials \
  -d client_id=dev-m2m-client \
  -d client_secret=dev-m2m-secret
```

Response (`200 OK`):

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImF1dGgtcHJveHk6bTJtOjEi...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

The dev client mints identity claims that match backend's `DEV_USER`
(`dev-user-001` / `dev-org-001` / `dev@localhost`), so any code path
that already works against `dev-token-static` works the same way through
M2M.

#### Production mode

Configure your client first (see
[auth-proxy/README.md](../../auth-proxy/README.md#enabling) for the
`M2M_CLIENTS` shape and secrets-manager guidance), then:

```bash
curl -X POST https://auth-proxy.example.com/api/auth/token \
  -d grant_type=client_credentials \
  -d client_id=svc-ingest \
  -d client_secret="$INGEST_SECRET"
```

### 2. Use

```bash
ACCESS_TOKEN="<access_token from step 1>"

curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     http://localhost:3000/api/projects
```

### 3. Revoke

M2M tokens have a TTL (default 1 hour) and **expire on their own** —
there is no revoke endpoint. To cut access to a service account before
expiry, rotate the secret in the secrets manager and reissue.
Expiration-by-rotation is intentional: it keeps the M2M path stateless
on the verifier side.

If you need immediate revocation, use a PAT instead.

---

## Common errors

| Status | Body                                  | Meaning                                                                    |
|--------|---------------------------------------|----------------------------------------------------------------------------|
| 401    | `Missing or invalid Authorization header` | No `Authorization: Bearer …` header on a protected route.              |
| 401    | `Invalid or expired token`            | Token signature failed to verify, expired, or (PATs only) revoked.         |
| 403    | `PATs may only be issued by an authenticated user` | You used a PAT or M2M token to call `POST /api/auth/pats`. |
| 404    | `not_found` (on `/api/auth/token` or `/api/auth/pats`) | `M2M_ENABLED` is unset or `false` on the auth-proxy.    |
| 400    | `unsupported_grant_type`              | M2M call with a grant other than `client_credentials`.                     |
| 401    | `invalid_client`                      | Unknown `client_id` or wrong `client_secret`.                              |

---

## Where to next

- [`auth-proxy/README.md`](../../auth-proxy/README.md) — full env-var
  reference, token shapes, and verification dispatch.
- [ADR-016: auth-proxy in the test stack](../decisions/adr-016-auth-proxy-in-test-stack.md)
  — production topology and the rationale for dev/prod parity.
