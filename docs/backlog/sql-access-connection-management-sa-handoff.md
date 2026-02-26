# Solutions Architect Handoff: SQL Access Connection Management

> **From**: Business Analyst
> **To**: Solutions Architect
> **Date**: 2026-02-26

---

## Context

Use the Solutions Architect system prompt at `.claude/system_prompts/SOLUTIONS_ARCHITECT.md`.

## Prompt

You are picking up a set of **validated feature requirements** from the Business Analyst for the next phase of SQL Access. Your job is to make the architectural decisions, design the integration points, and produce an implementation-ready technical plan.

### What to Read First

1. **Requirements doc** (your input — what to build):
   `docs/backlog/sql-access-connection-management-requirements.md`

2. **Technical exploration** (background context with initial design thinking):
   `docs/backlog/sql-access-connection-management.md`

3. **Current implementation** (understand what exists):
   - `backend/app/use_cases/sql_access/` — All current use cases (enable, disable, sync, reconcile, regenerate)
   - `backend/app/use_cases/sql_access/docker_provisioner.py` — Container lifecycle via aiodocker
   - `backend/app/use_cases/sql_access/pg_duckdb_manager.py` — DDL, credentials, S3 config
   - `backend/app/use_cases/sql_access/provisioner.py` — Provisioner protocol and registration
   - `backend/app/repositories/metadata/external_access_record.py` — Current data model
   - `frontend/src/lib/ui/components/SqlAccessPanel/` — Current UI component
   - `frontend/src/lib/ui/hooks/useSqlAccessQuery.ts` — Current React Query hooks
   - `frontend/src/lib/api/sqlAccess.ts` — Current API client

4. **Resolved prerequisite** (bugs that were fixed first):
   `docs/backlog/sql-access-fixes.md` and `openspec/changes/sql-access-fixes/`

5. **Existing feature spec** (Gherkin scenarios for current behavior):
   `features/external-data-access.feature`

### Decisions You Need to Make

The requirements doc defers these technical decisions to you. Each one needs a recommendation with trade-off analysis:

#### 1. Credential Proxy Architecture
The backlog doc proposes **PgBouncer with `auth_query`** as the proxy layer. Validate or propose alternatives.
- Is PgBouncer the right choice given our Docker-based ephemeral container model?
- How does `auth_query` integrate with our credential mapping table?
- Does session pooling mode (`pool_mode = session`) work correctly with pg_duckdb's session-level state (DuckDB extensions, search_path)?

#### 2. Proxy Deployment Model
The backlog recommends **sidecar per project** (one PgBouncer container per project). Evaluate:
- Sidecar: simple isolation, more containers (~5MB each), independent failure domains
- Shared instance: fewer resources, but shared failure domain and more complex routing
- Consider: we currently provision containers via aiodocker — the provisioner pattern would need to manage PgBouncer sidecars too

#### 3. Port Assignment Strategy
Currently, ephemeral containers get **dynamically auto-assigned ports**. With a proxy layer:
- Should the proxy port also be dynamic? (simpler, but connection string changes if proxy restarts)
- Should we use a deterministic mapping? (e.g., hash project_id to port range — stable but risks collisions)
- Should we use a fixed external port with internal routing? (requires shared proxy or external load balancer)
- **Key constraint**: the whole point of stable credentials is a stable connection string, so the port must be stable too.

#### 4. TLS Termination
- For local dev: not needed (localhost connections)
- For production: BI tools connecting over the network will need TLS
- Where should TLS terminate? At the proxy? At a load balancer in front of it?

#### 5. Credential Storage Security
The mapping table needs to store **ephemeral credentials** (the actual password to the pgduckdb container) so the proxy can authenticate. This is sensitive:
- Application-level encryption (encrypt before storing, decrypt in `auth_query` — but PgBouncer can't decrypt)?
- Database-level transparent encryption?
- Store as md5/scram hash that PgBouncer can use directly for `auth_query`?

#### 6. Migration Strategy for Existing Projects
Projects with SQL Access already enabled have ephemeral credentials. How do we transition?
- Add proxy + credential mapping to existing enabled projects?
- Require disable/re-enable?
- Background migration job?

### Scope Boundaries

**In scope for your design:**
- Service architecture (where does PgBouncer or alternative fit in the Docker topology?)
- Data model changes (credential_mapping table schema, relationship to external_access)
- API design (new endpoints for start/stop/status, modifications to existing enable/disable/regenerate)
- Provisioner changes (how to manage PgBouncer lifecycle alongside pgduckdb)
- Frontend-backend contract (request/response shapes for new endpoints)
- Error handling and compensation patterns (what happens when PgBouncer fails to start?)

**Out of scope (already decided by BA):**
- Single reader per project (not multi-user)
- System-generated username (`reader_{short_id}`)
- System-generated password (32-char alphanumeric)
- One-time password display (no recovery)
- Enable/disable vs. start/stop are distinct operations (see state machine in requirements)
- Status states: Running (healthy), Running (degraded), Stopped, Provisioning, Error
- UI layout (connection card + environment controls section below it)

### Recommended Approach

Use OpenSpec to formalize your design. Suggested workflow:

```bash
# Start a new change for this feature
/opsx:new sql-access-connection-management

# Fast-forward through all artifacts, or step through them:
/opsx:ff
# OR
/opsx:continue  # to review each artifact
```

Your artifacts should cover:
1. **Proposal**: Summarize the approach (proxy choice, deployment model, port strategy)
2. **Specs**: Delta specs for new capabilities (stable credentials, environment controls, connection card)
3. **Design**: Architecture diagram, data model, provisioner changes, API contracts, error handling
4. **Tasks**: Implementation checklist for the Software Engineer

### Success Criteria

Your design is ready for handoff to Software Engineering when:
- [ ] Every requirement in the requirements doc has a clear technical path
- [ ] New API endpoints are fully specified (method, path, request body, response body, error codes)
- [ ] Data model changes are defined (new tables, modified columns, migration approach)
- [ ] The provisioner protocol is extended to cover PgBouncer (or alternative) lifecycle
- [ ] Error/compensation flows are documented (what happens if proxy fails? if container dies? if mapping is stale?)
- [ ] The migration path for existing enabled projects is clear
- [ ] Frontend-backend contract changes are specified (new hooks, modified responses)
