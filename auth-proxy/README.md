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

A.2 (the next bead) layers a friendlier dev-mode setup on top of this
surface: synthetic clients available without WorkOS round-trips, sample
`M2M_CLIENTS` config, and integration with the local compose stack.
