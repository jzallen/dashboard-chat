# Multi-Tenancy Requirements

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-MT1 | All queries scoped by org_id via RestrictedSession | **Implemented** |
| NFR-MT2 | Query engine schemas isolated per project | **Implemented** |
| NFR-MT3 | Per-org rate limiting on upload and chat endpoints | **Not implemented** |

## Related

- `docs/architecture/backend-layers.md` (RestrictedSession)
