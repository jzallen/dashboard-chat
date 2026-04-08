# Security Requirements

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-SEC1 | All API endpoints require authentication except health checks and auth flow | **Implemented** |
| NFR-SEC2 | JWT tokens validated via JWKS in production (WorkOS) | **Implemented** |
| NFR-SEC3 | Backend trusts proxy headers only when TRUST_PROXY_HEADERS is set | **Implemented** |
| NFR-SEC4 | CORS restricted to configured origins | **Implemented** |
| NFR-SEC5 | Org-less users blocked from all endpoints except /api/orgs | **Implemented** |
| NFR-SEC6 | Parquet files encrypted at rest via SSE-S3 or SSE-KMS | **Not configured** |
| NFR-SEC7 | SQL credentials stored as hashed passwords; 60s regeneration cooldown | **Implemented** |

## Related

- External Access entity (NFR-SEC7)
