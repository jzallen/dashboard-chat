# Reliability Requirements

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-R1 | Outbox pattern for at-least-once event delivery | **Implemented** |
| NFR-R2 | Health check endpoints on all services | **Implemented** |
| NFR-R3 | Graceful shutdown on SIGTERM/SIGINT for agent | **Implemented** |
| NFR-R4 | Forward-compatible database migrations | **Implemented** |

## Related

- [NFR-H4: Query Engine Auto-Sync](nfr-h4-query-engine-auto-sync.md) (uses outbox pattern)
