# auth-proxy

Hono-based ingress that fronts backend and worker. Verifies Bearer JWTs
(WorkOS in production, dev backend's JWKS in dev), strips client-supplied
identity headers, and forwards `X-User-Id` / `X-Org-Id` / `X-User-Email`
to the upstream service. See [ADR-016](../docs/decisions/adr-016-auth-proxy-in-test-stack.md)
for the production-topology rationale.

## M2M (machine-to-machine) token issuance

Auth-proxy can mint short-lived JWTs for service-to-service callers via an
OAuth2 `client_credentials` grant. The same auth-proxy keypair signs and
verifies these tokens; existing WorkOS / dev backend tokens still verify
through the JWKS path.

**Disabled by default.** Production deployments must explicitly opt in.

### Enabling

| Env var                  | Required | Default               | Notes                                                       |
|--------------------------|----------|-----------------------|-------------------------------------------------------------|
| `M2M_ENABLED`            | yes      | `false`               | Set to `true` to expose `POST /api/auth/token`.             |
| `M2M_CLIENTS`            | yes      | _(none)_              | JSON map of clients (see below).                            |
| `M2M_TOKEN_TTL_SECONDS`  | no       | `3600`                | Token lifetime.                                             |
| `M2M_ISSUER`             | no       | `auth-proxy`          | `iss` claim on minted tokens.                               |
| `M2M_AUDIENCE`           | no       | derived from AUTH_MODE | `aud` claim on minted tokens.                              |
| `AUTH_PROXY_KEYPAIR_PATH` | no — but see [keypair persistence](#keypair-persistence) | _(unset)_ | Filesystem path for the persisted RS256 keypair JWK. Without it, restarts rotate the keypair and every still-live token (M2M and PAT) silently fails verification. |

`M2M_CLIENTS` shape:

```json
{
  "<client_id>": {
    "secret": "<plaintext-secret>",
    "sub": "<service-account-user-id>",
    "org_id": "<org-id>",
    "email": "<service-account-email>"
  }
}
```

The `sub`, `org_id`, and `email` fields become the identity headers
forwarded to backend / worker when the issued token is used as a Bearer.
Secrets are compared in constant time. Production deployments should
inject `M2M_CLIENTS` from a secrets manager rather than committing to
config; rotate by editing the env and restarting auth-proxy.

### Endpoint

```
POST /api/auth/token
Content-Type: application/x-www-form-urlencoded   # or application/json

grant_type=client_credentials
&client_id=<id>
&client_secret=<secret>
```

**200 OK**

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Error responses** follow OAuth2 error codes:

| Status | `error`                  | When                                     |
|--------|--------------------------|------------------------------------------|
| 400    | `invalid_request`        | Missing or malformed required fields.    |
| 400    | `unsupported_grant_type` | `grant_type` is not `client_credentials`.|
| 401    | `invalid_client`         | Unknown `client_id` or wrong secret.     |
| 404    | `not_found`              | `M2M_ENABLED` is unset / false.          |

### Example

```bash
curl -X POST https://auth-proxy.example.com/api/auth/token \
  -d grant_type=client_credentials \
  -d client_id=svc-ingest \
  -d client_secret="$INGEST_SECRET"

# Then call backend through the proxy:
curl -H "Authorization: Bearer <access_token>" \
     https://auth-proxy.example.com/api/projects
```

### How issued tokens verify

Minted tokens carry a fixed `kid` of `auth-proxy:m2m:1` in the protected
header. `verifyToken` (in `lib/auth.ts`) inspects `kid` first: a match
routes verification to the local in-memory public key; otherwise the
existing JWKS path runs unchanged. Backend's `TRUST_PROXY_HEADERS=true`
middleware branch then accepts the forwarded identity headers without
re-verifying the token.

### Dev-mode parity

When `AUTH_MODE=dev`, auth-proxy registers a built-in synthetic client so
M2M minting works locally and in tests without WorkOS round-trips and
without requiring `M2M_CLIENTS` to be configured. The built-in mints
identity claims that match backend's `DEV_USER` (the same identity that
`dev-token-static` represents):

| Field   | Value           |
|---------|-----------------|
| `client_id`     | `dev-m2m-client` |
| `client_secret` | `dev-m2m-secret` |
| `sub`           | `dev-user-001`   |
| `org_id`        | `dev-org-001`    |
| `email`         | `dev@localhost`  |

Suppressed outside dev mode: when `AUTH_MODE` is anything other than
`dev`, the built-in is **not** registered. Production deployments must
configure their own `M2M_CLIENTS` from a secrets manager.

User-supplied `M2M_CLIENTS` entries override the built-in if they share a
client_id (useful when a test needs to forge a different identity).

#### Dev-mode example

```bash
# 1. Start auth-proxy with M2M enabled (dev mode):
AUTH_MODE=dev M2M_ENABLED=true npm --workspace auth-proxy run dev

# 2. Mint a token with the built-in dev client (no extra config required):
curl -X POST http://localhost:3000/api/auth/token \
  -d grant_type=client_credentials \
  -d client_id=dev-m2m-client \
  -d client_secret=dev-m2m-secret

# 3. Call backend through auth-proxy:
curl -H "Authorization: Bearer <access_token>" \
     http://localhost:3000/api/projects
```

#### Production-mode example

```bash
# Configure clients (real client_id/client_secret pairs) and enable:
export AUTH_MODE=workos
export M2M_ENABLED=true
export M2M_CLIENTS='{"svc-ingest":{"secret":"…","sub":"service-account:svc-ingest","org_id":"org_…","email":"svc-ingest@…"}}'

curl -X POST https://auth-proxy.example.com/api/auth/token \
  -d grant_type=client_credentials \
  -d client_id=svc-ingest \
  -d client_secret="$INGEST_SECRET"
```

#### Token flow: client → auth-proxy → backend

1. Client posts `grant_type=client_credentials` to `POST /api/auth/token`
   on auth-proxy (gated by `M2M_ENABLED=true`).
2. Auth-proxy authenticates `client_id`/`client_secret` against the
   resolved client map (built-in dev + `M2M_CLIENTS`), then mints an
   RS256 JWT with `kid=auth-proxy:m2m:1`. Claims: `sub`, `org_id`,
   `email`, `iss`, `aud`, `iat`, `exp`.
3. Client sends the JWT as a Bearer to any auth-proxy route.
4. Auth-proxy's `verifyToken` sees the local `kid` and verifies against
   its in-memory keypair (no JWKS round-trip).
5. Auth-proxy injects `X-User-Id` / `X-Org-Id` / `X-User-Email` headers
   (stripping any client-supplied identity headers) and proxies the
   request to backend.
6. Backend, configured with `TRUST_PROXY_HEADERS=true`, accepts the
   forwarded identity directly via
   [`AuthMiddleware`](../backend/app/auth/middleware.py).

The `AUTH_MODE=dev` built-in produces tokens whose forwarded headers
match the dev compose stack's `DEV_USER`, so any backend code that
already works with `dev-token-static` works the same way through M2M.

#### Test compose stack (api-driven flow tests)

Per [ADR-016](../docs/decisions/adr-016-auth-proxy-in-test-stack.md), the
api-driven test stack is **5 services**: backend, worker, query-engine,
MinIO, and auth-proxy. The auth-proxy in that stack runs `AUTH_MODE=dev`
+ `M2M_ENABLED=true` (no `M2M_CLIENTS` needed) so test code can mint a
service token via `dev-m2m-client` / `dev-m2m-secret` and exercise the
production-fidelity ingress path. Backend's `TRUST_PROXY_HEADERS=true`
in that stack consumes the forwarded headers exactly as in production.

The receiving half of this contract is exercised in
[`backend/tests/integration/test_auth_proxy_m2m.py`](../backend/tests/integration/test_auth_proxy_m2m.py).

## PAT (Personal Access Token) issuance

In addition to the OAuth2 client_credentials flow above, auth-proxy can
issue **user-bound** PATs: long-lived (or explicitly time-bounded)
bearer credentials minted by an authenticated end user. PATs use the
same JWT/JWKS validation path the proxy already uses for every other
Bearer; the only addition is a store lookup so revocation takes effect
immediately rather than waiting for JWT expiry.

Same `M2M_ENABLED` flag gates this surface — both are non-interactive
credential paths and share configuration.

### Issuer endpoint

```
POST /api/auth/pats
Authorization: Bearer <user JWT>     # WorkOS or dev-backend user token; PATs may not mint PATs
Content-Type: application/json

{ "name": "<label>", "expires_in_seconds": 86400 }
```

`expires_in_seconds` is optional. Omit it for a long-lived PAT. The
issuer endpoint refuses any Bearer that is itself a PAT or an M2M
client_credentials token (returns 403) — only a real user JWT can mint
a PAT, which prevents a leaked credential from silently regenerating
itself.

**201 Created**

```json
{
  "id": "pat_<uuid>",
  "token": "<jwt>",
  "name": "<label>",
  "created_at": "2026-04-29T19:56:04.000Z",
  "expires_at": null
}
```

The `token` field is shown **once** at issuance — it is not stored in
plaintext and cannot be retrieved later. Lost tokens must be revoked
and reissued.

### Lifecycle endpoints

| Method | Path                       | Behavior                                                                 |
|--------|----------------------------|--------------------------------------------------------------------------|
| `POST` | `/api/auth/pats`           | Issue a PAT for the authenticated user.                                  |
| `GET`  | `/api/auth/pats`           | List the caller's PATs (id, name, timestamps, revoked_at). No tokens.    |
| `DELETE` | `/api/auth/pats/{id}`    | Revoke. Returns 204 on success, 404 if missing/already revoked/not yours. |

`DELETE` returns 404 (not 403) when the PAT belongs to another user, so
the existence of other users' PAT ids is not leaked.

### Token shape

PATs are RS256 JWTs signed with the same auth-proxy keypair that signs
M2M tokens, distinguished by `kid=auth-proxy:pat:1`. Payload claims:

| Claim    | Source                                  |
|----------|-----------------------------------------|
| `sub`    | Issuing user's `userId`                 |
| `org_id` | Issuing user's `orgId`                  |
| `email`  | Issuing user's `email`                  |
| `jti`    | PAT id (used for revocation lookup)     |
| `iss`    | `M2M_ISSUER` (default `auth-proxy`)     |
| `aud`    | `M2M_AUDIENCE` (or AUTH_MODE-derived)   |
| `iat`    | Issuance time                           |
| `exp`    | Present iff `expires_in_seconds` was set |

### Verification flow

`verifyToken` (in `lib/auth.ts`) inspects `kid` first:

1. `kid=auth-proxy:m2m:1` → existing M2M verifier (local keypair).
2. `kid=auth-proxy:pat:1` → PAT verifier: signature check **plus** a
   store lookup on `jti`. Tokens whose record is missing or revoked are
   rejected with the same 401 the proxy returns for any other invalid
   Bearer.
3. Anything else → existing JWKS path (WorkOS or dev backend).

Backend's `TRUST_PROXY_HEADERS=true` middleware branch then accepts the
forwarded identity headers exactly as for any other Bearer.

### Storage and persistence

PAT records are kept in an in-memory `Map<jti, PatRecord>`. Set
`PAT_STORE_PATH` to enable file persistence (append-only JSONL; the
file is replayed on boot). Without `PAT_STORE_PATH`, PATs do not
survive an auth-proxy restart — fine for tests and ephemeral envs, but
production deployments should mount a volume and set the env var.

| Env var          | Required | Default | Notes                                                                       |
|------------------|----------|---------|-----------------------------------------------------------------------------|
| `PAT_STORE_PATH` | no       | _(unset)_ | Filesystem path for the JSONL store. When unset, PATs are in-memory only. |

PAT records carry no token material — only id, owner identity, name,
and timestamps. Compromise of the store does **not** leak usable
tokens; it does leak metadata about who minted what and when, so
permissions on the store path should match the rest of auth-proxy's
runtime.

### Keypair persistence

PATs (and M2M tokens) are RS256-signed with a process-local keypair.
By default the keypair is generated fresh on first use **and lost on
process exit** — which silently invalidates every previously-issued
PAT at the next restart, regardless of `expires_in_seconds`. PATs are
documented as long-lived so this is not a safe production default.

Set `AUTH_PROXY_KEYPAIR_PATH` to a filesystem path to persist the
keypair as JWK JSON. The path is read on first use; if the file
exists it is loaded, if it does not the freshly-generated keypair is
written there (atomically, mode `0600`) so subsequent boots reuse it.

| Env var                   | Required | Default   | Notes                                                                            |
|---------------------------|----------|-----------|----------------------------------------------------------------------------------|
| `AUTH_PROXY_KEYPAIR_PATH` | strongly recommended in production | _(unset)_ | Path for the persisted RS256 keypair (JWK JSON). Without it, restarts invalidate every issued PAT and every M2M token still inside its TTL. |

The persisted file contains private key material; mount it from a
secrets-grade volume and restrict access (parent directory, perms,
backup policy) the same way you would treat a TLS private key. To
rotate, delete (or move aside) the keypair file and restart
auth-proxy — at the cost of invalidating all currently-issued tokens.
A graceful in-place rotation (overlap window with two `kid`s) is not
implemented today.
