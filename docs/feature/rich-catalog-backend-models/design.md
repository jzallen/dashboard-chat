# Rich-Catalog Backend Models — DESIGN

**Wave:** DESIGN (brownfield entry)
**Author:** Hera (nw-ddd-architect)
**Status:** Proposed — design only, no code, no ADR edits, no commit
**Scope:** Three backend domain additions that back three fixture-only `ui/` catalog
surfaces (`getOrg`, `getAudit`, `getDbtFiles`), plus their UI-catalog mapping and
(for the audit one) the agent persistence hook.

> Decisions in the seed brief are taken as given; this document designs *to* them and
> records the trade-offs the seed asked for. Every claim about existing code is cited
> `file:line`.

---

## 0. Context recap (verified against the tree)

- The catalog reads through the `CatalogSource` port
  (`ui/src/lib/catalog/dataSources/source.ts:21-32`), backed by a
  `PartialCatalogSource` (`metadataApiSource`,
  `ui/src/lib/catalog/dataSources/metadataApiSource.ts:85-226`) over a
  stale-while-revalidate store (`ui/src/lib/catalog/client.ts:63-310`).
- `getOrg` / `getAudit` / `getDbtFiles` are **not** implemented by `metadataApiSource`
  today, so they fall through to the fixture fallback
  (`metadataApiSource.ts` implements only `getProjects`, `getCurrentProject`,
  `getNodes`, `getEdges`, `getAudit→{}`, `getRecents`, `getAllChats`;
  `client.ts:138-155` shows `getOrg`/`getDbtFiles` are revalidated only if the primary
  implements them).
- The backend is a **pure resource server**: identity arrives as auth-proxy headers
  `X-User-Id` / `X-Org-Id` / `X-User-Email` (`backend/app/auth/middleware.py:45-58`),
  hydrated into `AuthUser{id, email, org_id, name, org_name}`
  (`backend/app/auth/types.py:4-10`). **There is no `User` or `Membership` table** —
  grep across `backend/app/models` finds no user/member entity. This is load-bearing
  for the `members[]` design (§1).
- Use cases follow the decorator stack `@handle_returns` / `@with_repositories` with
  `org_id` scoping (skill: `backend-use-case`); responses are JSON:API via
  `wrap_jsonapi_single` / `wrap_jsonapi_list`
  (`backend/app/controllers/response_wrapper.py:13-33`).
- `Transform` is the SQL-affecting entity: domain model
  `backend/app/models/transform.py:17-85` (status `enabled|disabled|deleted`), ORM
  `backend/app/repositories/metadata/transform_record.py:19-75` (FK
  `dataset_id → datasets.id`). Dataset staging SQL is recompiled from the dataset's
  transforms on read — `Dataset.staging_sql`
  (`backend/app/models/dataset.py:188-191`) folds `self.transforms` through
  `build_staging_sql`, and only enabled transforms participate
  (`dataset.py:138-140,243-251`). **A transform enable/disable write already exists**:
  `PATCH /api/datasets/{dataset_id}/transforms`
  (`backend/app/routers/transforms.py:45-69` →
  `backend/app/controllers/dataset_controller.py:194-195`), which is the recompile
  hook the audit toggle reuses.

---

## 1. `OrgSettings` — back `getOrg` (read-only)

### 1.1 UI target

`OrgSettings` (`ui/src/lib/catalog/models.ts:185-196`):
`{ name, slug, region, plan, seats, usedSeats, created, members[], defaults{engine, materialization, modelPrefix} }`,
where `members: OrgMember[] = { name, email, role }[]`
(`ui/src/lib/catalog/models.ts:178-183`).

### 1.2 Bounded context + subdomain

Belongs to the existing **Org / Project** context (`backend/`), classified
**Supporting** in the current map (architecture brief `## Domain Model`,
brief.md:122-126). No new context. The org-settings fields are org-configuration, not
a new subdomain — modelling them as a settings value attached to the org aggregate
keeps the boundary intact.

### 1.3 Domain model — where the fields live

The `Organization` aggregate today (`backend/app/models/organization.py` — note: the
ORM is `OrganizationRecord` at `organization_record.py:11-28`; there is **no** rich
domain `Organization` class, only `organization_to_dict` at `_mappers.py:118-125`)
carries `{id, name, created_at, updated_at}` only.

**Decision (per seed): model `name/slug/region/defaults` for real; STUB
`plan/seats/usedSeats`; derive `members[]` from org users.**

Modelling choice — **a dedicated `OrgSettings` value object on the org aggregate**, not
loose columns:

- `slug`, `region`, and the three `defaults` are a cohesive *configuration* concept
  with a single lifecycle (they change together, in a future settings-edit screen).
  They are a **value object** (DDD building block) owned by the `Organization`
  aggregate root — Vernon rule 1 (one invariant boundary: an org's identity + its
  settings) and rule 2 (small aggregate: root + one value-typed group, no child
  entities).
- Persistence: the value object's fields land as **columns on the `organizations`
  table** (a VO does not get its own table when it is 1:1 with its root and has no
  identity of its own). New columns: `slug`, `region`, `default_engine`,
  `default_materialization`, `default_model_prefix`. All nullable with sensible
  server defaults so the migration is backfill-safe (§1.5).
- `plan` / `seats` / `usedSeats`: **not modelled** — no billing domain exists and the
  seed forbids inventing one. They are emitted as **static placeholder constants** at
  the response boundary (e.g. `plan="free"`, `seats=5`, `usedSeats=len(members)`).
  Document them as a stub in the mapper so a future billing context is an additive
  change, not a rework.

### 1.4 `members[]` — the load-bearing constraint

**There is no user/membership table.** The only identity the backend ever sees is the
*current* request's `AuthUser` from auth-proxy headers (`auth/middleware.py:52-58`).
The backend cannot enumerate "all users in an org" because it never persists users.

Options for `members[]`:

- **(A) Self-only member list (recommended).** `members[]` contains exactly the calling
  user, derived from `AuthUser`: `{ name: user.name ?? user.email, email: user.email,
  role: "owner" }`. Honest about what the backend actually knows; zero new tables; no
  invented domain. `usedSeats` = `len(members)` = 1.
- **(B) New `OrgMembership` aggregate.** A real `org_memberships` table
  (`{id, org_id, user_id, email, display_name, role}`), populated... by what? No
  signup/invite flow writes it. It would be empty or require a write path that does
  not exist. **Rejected** — it invents a membership domain the seed explicitly scopes
  out, and would ship perpetually-empty.
- **(C) Distinct-creator derivation.** Derive members from distinct `created_by` on
  org-owned resources — but no resource carries `created_by` today (grep:
  datasets/projects/views/reports have no creator column). **Rejected** — requires a
  schema change to every resource for a read-only cosmetic list.

**Recommendation: Option A** now. Note as an open question (§7) that real
multi-member orgs need a membership-projection fed by auth-proxy / WorkOS — a future
**Org / Project** ↔ **Authentication** context integration, out of scope here.

### 1.5 Persistence + migration outline

New columns on `organizations` (per `alembic-migration` skill — portable, no
`alter_column`, server defaults so existing rows backfill):

```python
# migrations/versions/016_add_org_settings_columns.py  (down_revision = "015")
def upgrade() -> None:
    op.add_column("organizations", sa.Column("slug", sa.String(255), nullable=True))
    op.add_column("organizations", sa.Column("region", sa.String(64), nullable=False,
        server_default="us-east-1"))
    op.add_column("organizations", sa.Column("default_engine", sa.String(64),
        nullable=False, server_default="duckdb"))
    op.add_column("organizations", sa.Column("default_materialization", sa.String(32),
        nullable=False, server_default="view"))
    op.add_column("organizations", sa.Column("default_model_prefix", sa.String(64),
        nullable=False, server_default=""))

def downgrade() -> None:
    op.drop_column("organizations", "default_model_prefix")
    op.drop_column("organizations", "default_materialization")
    op.drop_column("organizations", "default_engine")
    op.drop_column("organizations", "region")
    op.drop_column("organizations", "slug")
```

- `slug` derives from `name` at write time in a future edit flow; for now nullable,
  and the mapper falls back to a slugified `name` when null (no migration data step
  needed).
- No `org_id` index needed — `organizations.id` *is* the org id (PK already indexed,
  `organization_record.py:16-20`).

### 1.6 Endpoint + use-case

**Decision: enrich the existing `GET /api/orgs/me`** (`organizations.py:33-40`) rather
than add `/api/orgs/me/settings`. One org read, one round-trip; the UI's `getOrg`
already wants the whole `OrgSettings` blob and there is no settings-edit surface to
justify a separate sub-resource. (If/when an edit UI lands, `PATCH /api/orgs/me` is the
natural companion — additive.)

New read use-case `get_org_settings`:

```python
# app/use_cases/organization/get_org_settings.py
@handle_returns
@with_repositories
async def get_org_settings(*, user: AuthUser,
                           repositories: "RepositoryContainer") -> OrgSettings:
    org = await repositories.metadata.get_organization(user.org_id)   # by-PK == org scope
    if org is None:
        raise OrganizationNotFound(user.org_id)
    return OrgSettings.from_record(org, current_user=user)            # VO assembly + member-self + stubs
```

- `org_id` scoping: fetching the org by `user.org_id` *is* the tenancy boundary
  (by-PK fetch where the PK is the org id — the skill's "fetch by primary key OK after
  ownership check" applies; the user's own org is by definition theirs).
- `OrgSettings` here is a backend **DTO/response object**, not the UI type — it carries
  the VO + stub fields and a `serialize()` for the boundary.

### 1.7 JSON:API shape + UI mapping

```jsonc
// GET /api/orgs/me  → wrap_jsonapi_single("organizations", {...}, "/api/orgs/me")
{
  "data": {
    "type": "organizations",
    "id": "dev-org-001",
    "attributes": {
      "name": "Acme", "slug": "acme", "region": "us-east-1",
      "plan": "free", "seats": 5, "used_seats": 1,           // stubs
      "created_at": "2026-01-01T00:00:00Z",
      "members": [{ "name": "Dev User", "email": "dev@…", "role": "owner" }],
      "defaults": { "engine": "duckdb", "materialization": "view", "model_prefix": "" }
    }
  }
}
```

UI mapping — implement `metadataApiSource.getOrg`
(`metadataApiSource.ts`, new getter) mapping snake→camel:
`attributes.used_seats → usedSeats`, `attributes.created_at → created`,
`attributes.defaults.model_prefix → defaults.modelPrefix`, rest pass-through. The
catalog already revalidates `getOrg` at construction once the primary implements it
(`client.ts:138-143`) — **no client.ts change required**, the getter just stops being
absent. Read-only; no write surface, no `OrgSettings` UI-shape change.

---

## 2. `AssistantAuditEntry` — back `getAudit` (the substantial one)

> **Naming — the three-layer split (architectural guard `agent/test/chat/acceptance/worker-tool-dispatch.test.ts` AC1.4/K2).**
> The backend must not adopt agent/chat vocabulary: a structural guard greps
> `backend/app/**.py` for `\b(groq|sse|tool_call|tool_calls)\b` and asserts ZERO
> matches. So the concept is named per layer:
> - **Backend (`backend/app`): `AssistantAuditEntry`** — table `assistant_audit_entries`,
>   endpoint `/api/projects/{pid}/audit`, reversed FK `transforms.assistant_audit_entry_id`,
>   use-case package `app/use_cases/assistant_audit`. NO "tool call" vocabulary anywhere.
> - **Agent (`agent/`): `AssistantToolCall`** — tool-call vocabulary is expected here
>   (the guard's sanity check requires `agent/lib/chat/` to contain it). The agent records a
>   tool call by POSTing it to the backend's `/audit` endpoint and threads the returned id
>   back as `assistant_audit_entry_id` on the transform create.
> - **UI (`ui/`): `AuditEntry`** with field `auditEntryId` (the backing `AssistantAuditEntry`
>   id; write target for the future toggle).

### 2.1 UI target

`AuditEntry` (`ui/src/lib/catalog/lineage.ts:51-56`): `{ tool, say, tag }`,
`tag ∈ AUDIT_TAGS` (`lineage.ts:34-49`:
`create|source|join|filter|grain|measure|config|clean|fix|cast|shape`). Rendered
per-node in `ModelDetail`'s "Assistant changes" panel
(`ui/src/app/ModelDetail/ModelDetail.tsx:71-113`). `getAudit` returns
`Record<nodeId, AuditEntry[]>` — today `{}` (`metadataApiSource.ts:202-205`).

### 2.2 Concept + bounded context

A **`AssistantAuditEntry`** is the persisted log of an assistant tool call made against a
model/node. The UI audit list is a **projection** of a node's `AssistantAuditEntry[]` →
`AuditEntry[]`. It belongs to the **Org / Project** context (it logs writes against
that context's datasets/views/reports). It is a **new aggregate** in that context — see
boundary analysis below.

### 2.3 Domain model + aggregate boundary

**`AssistantAuditEntry` is its own aggregate** (root entity, value-typed properties — Vernon's
~70% root-only case), referencing other aggregates **by id**:

| Vernon rule | How satisfied |
|---|---|
| 1 — true invariants in boundary | A single recorded tool call (who/what/when/narrative/tag, and at most one transform ref) is a self-contained immutable fact. Nothing else must change in the same transaction when one is recorded. |
| 2 — small aggregate | Root entity only; all properties value-typed; no child entities. |
| 3 — reference other aggregates by id | `node_id` (the lineage node = dataset/view/report id), `project_id`, `org_id`, and `transform_id` are all **id references**, never embedded entities. It does **not** absorb `Transform`. |
| 4 — eventual consistency outside | The toggle's effect on `Transform.status` (and thus on dataset staging SQL) is a separate transaction on the `Transform` aggregate, reached via id. The tool-call log and the transform are eventually consistent, coordinated by the toggle use-case (§2.7), not a shared invariant. |

**AMENDMENT (per review) — generic JSON spine + REVERSED FK.** The tool-call record is a
**generic spine** (scoping columns + a JSON payload of the tool-call content); it carries
NO per-subtype columns. The FK is **reversed**: `Transform` points UP at the tool-call
record (`Transform.assistant_audit_entry_id`), not the other way around. Pattern: a generic
command/event record + typed "detail" tables that reference it by FK. Future detail
types (join detail, view-edit detail, …) add their own FK back to the spine — no
polymorphic table, no wide-nullable table, no `detail_type`/`detail_id` association, FK
integrity preserved. This supersedes the `transform_id`-on-the-tool-call wording anywhere
below.

Fields (`assistant_audit_entries`):

| Field | Type | Notes |
|---|---|---|
| `id` | str (uuidv7) | PK |
| `org_id` | str | tenancy; **indexed** (column, not JSON — every read filters by it) |
| `project_id` | str | id ref → project; indexed |
| `node_id` | str | id ref → the lineage node (dataset/view/report id); indexed (`getAudit` groups by it) |
| `node_kind` | str | `dataset\|view\|report` — disambiguates `node_id` namespace (§7) |
| `payload` | JSON | the variable tool-call content: `{ tool, say, tag, args? }` → maps to `AuditEntry.{tool,say,tag}`. `tag` validated against `AUDIT_TAGS` at the inbound boundary (§2.8). No typed per-tool columns. |
| `sequence` / `created_at` | int / datetime | ordering within a node's audit list |

**`Transform` gains the FK** (the reversal): add `assistant_audit_entry_id str \| null` →
**FK → assistant_audit_entries.id, `ON DELETE SET NULL`**, nullable (legacy transforms predate
tool calls), indexed. `Transform` otherwise unchanged (`transform_record.py:19-75`, still
FK to its `Dataset`).

**Relationship summary:**
`AssistantAuditEntry (N) ──node_id (id ref)──▶ Dataset|View|Report (1)` and
`Transform (0..1) ──assistant_audit_entry_id (FK)──▶ AssistantAuditEntry (1)`.
A tool call is **transform-type (toggleable) iff a `Transform` row references it** — read
by joining `transforms` to `assistant_audit_entries` on `assistant_audit_entry_id` (§2.11), not by a column
on the spine. Non-transform calls (`createView`, `addJoin`, `addMeasure`, …) simply have
no `Transform` pointing at them → log-only. Scoping/grouping keys stay typed columns; only
the variable tool content is JSON (keys-as-columns for cheap tenancy + `node_id` grouping).

### 2.4 Which tags are transform-type

`Transform` only exists for **dataset cleaning/filtering** ops
(`transform.py:14` `TransformType = filter|clean|alias|map`). Mapping to tags:

| Tag | Transform-type? | Producing tools |
|---|---|---|
| `clean` | **yes** | `trimWhitespace`, `standardizeCase`, `fillNulls`, `applyCleaningTransform` (`agent/lib/chat/tools.ts:56-101`) |
| `fix` | **yes** | `fillNulls`/map-style fixes (clean transforms) |
| `cast` | **yes** | type-cast clean transforms |
| `map` (→ `cast`/`fix`) | **yes** | `mapValues` (`tools.ts:83-92`) |
| `filter` | **yes** | dataset row filters (filter transform) |
| `create`, `source`, `join`, `grain`, `measure`, `config`, `shape` | **no** | view/report structural ops (`viewTools.ts`, `reportToolDefinitions.ts`) — log-only |

Rule of thumb: **a `AssistantAuditEntry` is transform-type iff it produced a
`TransformRecord`** (dataset cleaning/filter ops). That is the precise, code-anchored
definition — the `transform_id` is non-null exactly when the agent's tool execution
created/updated a transform. The tag table above is the *expected* correspondence, but
**`transform_id` non-null is the source of truth for toggleability**, not the tag.

### 2.5 The toggle (the first audit/transform WRITE)

Transform-type audit entries are toggleable in the UI; toggling
enables/disables the referenced `Transform`, which recompiles the dataset's staging
SQL/preview.

**Key finding — the recompile machinery already exists.** `Dataset.staging_sql`
recompiles from enabled transforms on every read
(`dataset.py:188-191`; only-enabled at `dataset.py:243-251`), and a status write path
exists: `PATCH /api/datasets/{dataset_id}/transforms` with `status` updates
(`transforms.py:45-69` → `dataset_controller.py:194-195`
`update_transforms(dataset_id, updates)`). So the toggle is a **proxy** onto existing
infrastructure — no new recompile code.

**`AuditEntry` shape change** (`ui/src/lib/catalog/lineage.ts:51-56`): add
toggle-related fields so the panel can render and drive the toggle:

```ts
export interface AuditEntry {
  tool: string;
  say: string;
  tag: AuditTag;
  auditEntryId?: string;     // the AssistantAuditEntry id (write target)
  transformId?: string;    // present ⇔ transform-type (toggleable)
  enabled?: boolean;       // current Transform.status === "enabled"; undefined for log-only
}
```

`ModelDetail` impact (`ModelDetail.tsx:91-109`): the audit `.map` gains a
radio/toggle control rendered only when `a.transformId != null`, bound to
`a.enabled`, calling the new catalog toggle command (§4). Log-only entries render
unchanged.

### 2.6 Toggle endpoint

Two options:

- **(A) PATCH the tool-call.** `PATCH /api/projects/{pid}/audit/{id}` with
  `{ enabled }`; the use-case resolves `transform_id` and proxies to the transform
  status update. **Recommended** — the UI holds a `auditEntryId`, the audit projection is
  the UI's mental model, and the backend owns the tool-call→transform indirection
  (the UI never needs to know the dataset id or transform id).
- **(B) PATCH the transform directly.** Reuse
  `PATCH /api/datasets/{dataset_id}/transforms` as-is. Fewer new endpoints, but leaks
  the dataset id + transform id into the audit UI and bypasses the tool-call as the
  unit the user is acting on. Keep it as the *internal* call the (A) use-case makes.

**Recommendation: A on the surface, delegating to the existing transform-status update
internally.** Use-case:

```python
# app/use_cases/assistant_audit/toggle_audit_entry.py
@handle_returns
@with_repositories
async def toggle_audit_entry(assistant_audit_entry_id: str, enabled: bool, *, user: AuthUser,
                           repositories: "RepositoryContainer") -> ToolCall:
    tc = await repositories.metadata.get_audit_entry(assistant_audit_entry_id, org_id=user.org_id)
    if tc is None: raise AuditEntryNotFound(assistant_audit_entry_id)
    # Reversed FK: find the Transform that points UP at this tool-call record.
    transform = await repositories.metadata.get_transform_by_audit_entry(
        assistant_audit_entry_id, org_id=user.org_id)
    if transform is None: raise AuditEntryNotToggleable(assistant_audit_entry_id)  # nothing references it → log-only
    status = "enabled" if enabled else "disabled"
    await repositories.metadata.update_transform_status(transform.id, status,
                                                        org_id=user.org_id)
    return tc  # node_id lets the controller tell the UI which node's audit to revalidate
```

Decorator stack + `org_id` scoping per skill. The transform status update is the
existing one (`dataset_controller.py:194-195` machinery), reached via `transform_id`.

### 2.7 Persistence hook — the AGENT

The agent executes tool calls and already POSTs view/report/transform changes to the
backend (FE analog `frontend/src/core/toolCalls/viewTools.ts:46-196` PATCHes views via
the catalog; agent tool defs `agent/lib/chat/tools.ts`,
`agent/lib/chat/reportToolDefinitions.ts`). **Where does a `AssistantAuditEntry` get
persisted?**

Two options:

- **(A) Dedicated `POST .../audit` the agent calls.** After each successful tool
  execution the agent POSTs `{ node_id, node_kind, tool, say, tag, transform_id? }` to
  `POST /api/projects/{pid}/audit`.
  - *Pro:* the agent owns the narrative (`say`) and the tag (it knows which tool ran);
    one obvious write site; backend stays dumb.
  - *Con:* couples the agent to a new backend endpoint and to the tag vocabulary; an
    extra round-trip per tool; the agent must thread `transform_id` back from the
    transform-creating call's response.
- **(B) Backend records its own writes.** Each existing mutation use-case
  (create-view, create-report, create/update-transform) emits a `AssistantAuditEntry` as a
  side effect within the same transaction.
  - *Pro:* "the backend records its own writes" — no agent coupling, the tool-call and
    the transform are written in **one transaction** (no orphaned/missed log on agent
    crash), `transform_id` is trivially available in-process.
  - *Con:* the **narrative `say`** and the precise **tool name** live in the agent/LLM,
    not the backend (the backend sees a structured mutation, not "I trimmed whitespace
    on `email`"). The backend would synthesize a generic `say`, losing the
    chat-quality prose the panel is designed for; and the use-cases are also driven by
    the FE directly (not only the agent), so "tool call" framing is wrong for FE-origin
    writes.

**Recommendation: a HYBRID — Option B as the system of record for the *fact* + the
`transform_id` linkage, with the agent enriching `say`/`tool`/`tag` via Option A's
endpoint (upsert).** Concretely:

- The mutation use-cases write a skeletal `AssistantAuditEntry` in-transaction (guarantees the
  fact + `transform_id` are never lost, no orphaned log on agent crash) with a default
  derived `say`/`tag`.
- The agent, post-execution, **upserts** the human narrative via
  `POST /api/projects/{pid}/audit` keyed by the just-created
  resource (or its returned `assistant_audit_entry_id`), enriching `say`/`tool`/`tag`.

If the team wants the simplest first cut: **start with pure Option A** (agent POSTs
the whole record) because it delivers the full-fidelity `say`/`tag` the panel needs and
requires no change to every mutation use-case; accept the agent-crash gap (a missed log
line, not data corruption — the transform itself still persisted via its own endpoint)
and the extra round-trip. Promote to the hybrid when the missed-log gap matters.
**Document this as the primary open question (§7).**

### 2.8 `tag` derivation + where the mapping lives

The `tag` is derived from the **tool name** (the `AUDIT_TAGS` vocabulary mirrors tool
families — `clean`/`fix`/`cast` from cleaning tools, `join`/`filter`/`grain`/`measure`
from view/report tools). The mapping is a small `Record<toolName, AuditTag>`.

**Where:** it belongs with whoever sets `tag`. Under the recommended agent-owned path,
the map lives in the **agent** (alongside `agent/lib/chat/tools.ts` /
`reportToolDefinitions.ts`, where the tool names are defined) so it stays co-located
with its source of truth and the agent sends the resolved `tag`. The backend treats
`tag` as a validated string (Zod/Pydantic enum against `AUDIT_TAGS` at the inbound
boundary — domain-modeling skill: validate untrusted input at the edge). If the team
prefers a single SSOT, promote the map into `shared/chat/` (the existing cross-cutting
chat package, per CLAUDE.md) so both agent and any backend synthesis read one list.

### 2.9 The before/after `sample`

The panel pairs each dataset audit line with a transform before/after sample
(`ModelDetail.tsx:74-104`, reading `m.transforms[i].sample`). That `sample` is
**non-persisted** — it comes only from the transform *preview* endpoint
(`backend/app/routers/transforms.py:72-80`,
`HTTPController.preview_transform`). The UI `Transform.sample`
(`ui/src/lib/catalog/models.ts:90-98`) is a fixture-only field.

Options: persist on the `Transform`/`AssistantAuditEntry`; compute on demand; or drop
before/after from the panel.

**Recommendation: drop the persisted before/after from the audit panel for the
backend-backed path** (keep it for the fixture demo only). Rationale:

- Persisting a `sample` snapshot couples a cosmetic string to every transform write and
  goes stale the moment upstream data changes — it would lie.
- Computing on demand means a preview round-trip per audit line per node-open —
  expensive and only meaningful for cleaning transforms.
- The panel's *value* is the narrative `say` + the toggle, not the sample string.

If a before/after is wanted later, compute it **lazily on hover/expand** via the
existing preview endpoint for the single transform — an additive UI affordance, not a
persistence decision. Document as an open question (§7).

### 2.10 Persistence + migration outline (`assistant_audit_entries`)

```python
# migrations/versions/017_add_assistant_audit_entries.py  (down_revision = "016")
def upgrade() -> None:
    # 1) the generic spine — scoping columns + a JSON payload, NO per-subtype columns.
    op.create_table(
        "assistant_audit_entries",
        sa.Column("id", sa.Text(), nullable=False, server_default=sa.text("(uuidv7())")),
        sa.Column("org_id", sa.Text(), nullable=False),
        sa.Column("project_id", sa.Text(), nullable=False),
        sa.Column("node_id", sa.Text(), nullable=False),
        sa.Column("node_kind", sa.Text(), nullable=False),          # dataset|view|report
        sa.Column("payload", sa.JSON(), nullable=False),            # { tool, say, tag, args? }
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_assistant_audit_entries_org_id", "assistant_audit_entries", ["org_id"])   # REQUIRED
    op.create_index("ix_assistant_audit_entries_project_id", "assistant_audit_entries", ["project_id"])
    op.create_index("ix_assistant_audit_entries_node_id", "assistant_audit_entries", ["node_id"])

    # 2) the REVERSED FK — the detail record (Transform) points UP at the spine.
    op.add_column(
        "transforms",
        sa.Column("assistant_audit_entry_id", sa.Text(),
                  sa.ForeignKey("assistant_audit_entries.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_transforms_assistant_audit_entry_id", "transforms", ["assistant_audit_entry_id"])

def downgrade() -> None:
    op.drop_index("ix_transforms_assistant_audit_entry_id", table_name="transforms")
    op.drop_column("transforms", "assistant_audit_entry_id")
    op.drop_index("ix_assistant_audit_entries_node_id", table_name="assistant_audit_entries")
    op.drop_index("ix_assistant_audit_entries_project_id", table_name="assistant_audit_entries")
    op.drop_index("ix_assistant_audit_entries_org_id", table_name="assistant_audit_entries")
    op.drop_table("assistant_audit_entries")
```

- **Reversed FK** `transforms.assistant_audit_entry_id → assistant_audit_entries.id`, `ON DELETE SET NULL`:
  the detail points at the spine. `SET NULL` (vs CASCADE) means deleting a tool-call
  record downgrades the transform to "no recorded provenance" rather than deleting the
  transform; nullable because legacy transforms predate tool calls. The spine is never
  deleted when a transform is.
- SQLite/PG portable: `sa.Text`, `sa.JSON` (TEXT under SQLite, JSON/JSONB under PG —
  the variable payload), `(uuidv7())` server default, `org_id` indexed — per the
  `alembic-migration` skill. (If `add_column` + FK on the existing `transforms` table is
  awkward under SQLite batch mode, split the `transforms` alter into its own migration
  using `op.batch_alter_table` — note for the implementer.)

### 2.11 Read endpoint (`getAudit` backing)

`GET /api/projects/{pid}/audit` → JSON:API list, ordered by
`(node_id, sequence, created_at)`. Use-case `list_audit_entries_for_project` (decorator
stack, `org_id`-scoped). The controller groups by `node_id` into the
`Record<nodeId, AuditEntry[]>` shape — or returns a flat list and the
`metadataApiSource.getAudit` does the grouping (recommended: flat list from the API,
grouping in the mapper, mirroring how `metadataApiSource` already derives the lineage
graph client-side from flat resource lists, `metadataApiSource.ts:121-146`).

```jsonc
// item attributes
{ "node_id": "stg_patients", "node_kind": "dataset", "tool": "trimWhitespace",
  "say": "Trimmed whitespace on email", "tag": "clean",
  "transform_id": "…", "enabled": true }   // enabled folded in from the joined transform status
```

The read use-case **left-joins `transforms ON transforms.assistant_audit_entry_id = assistant_audit_entries.id`**
(the reversed FK). In the projection, `transform_id` is the joined transform's id —
**present ⇔ toggleable** — and `enabled` is the joined `Transform.status == "enabled"`
(for the toggle's initial render). `tool`/`say`/`tag` are read from the record's `payload`
JSON. Log-only calls (no transform points at them) project `transform_id: null`, no toggle.

---

## 3. `DBTProjectDetails` — back `getDbtFiles` (read-only)

### 3.1 UI target

`DbtFile[]` (`ui/src/lib/catalog/models.ts:219-224`): `{ path, layer, ref }`,
`layer ∈ Layer | "config"` — a browsable file index in the dbt export/download modal.

### 3.2 Decision — JSON manifest endpoint sharing the zip's source of truth

Today `GET /api/projects/{id}/export/dbt` streams a zip
(`backend/app/routers/projects.py` ~line 61; use-case
`export_dbt_project.py:25-73` → `generate_dbt_project_zip`
`_dbt/__init__.py:68-178`). No JSON manifest exists.

**Decision (per seed): add `GET /api/projects/{id}/export/dbt/manifest`** returning
`DBTProjectDetails` (file index + layer counts + project name), derived from the **same
generation logic** that builds the zip. The download stays the zip.

**Refactor for a shared source of truth.** `generate_dbt_project_zip`
(`_dbt/__init__.py:68-178`) currently computes the full file plan (the `ref_name_map`
at `:101-121`, the staging/intermediate/marts paths at `:139-170`) and writes bytes in
one pass. Extract the *file-plan* computation into a pure function:

```python
# _dbt/manifest.py
def build_dbt_file_plan(project, *, views, reports) -> list[DbtFileEntry]:
    """The list of (path, layer, ref) the zip will contain — no bytes."""
```

- `generate_dbt_project_zip` calls `build_dbt_file_plan` and then writes each entry's
  bytes (the generators it already calls per file: `generate_model_sql`,
  `generate_intermediate_sql`, `generate_mart_sql`, plus the config files). This makes
  the manifest and the zip share one path/layer source of truth — adding a model file
  to the zip can no longer drift from the manifest.
- `layer` per entry: `staging` for `models/staging/stg_*.sql`, `intermediate` for
  `models/intermediate/int_*.sql`, `mart` for `models/marts/**/{fct,dim}_*.sql`,
  `config` for `dbt_project.yml`/`profiles.yml`/`sources.yml`/`schema.yml`/`macros/*`/
  `README.md`/`packages.yml`/`scripts/*` (the non-model files at
  `_dbt/__init__.py:137-156,172-176`). This matches the UI `Layer | "config"` union
  exactly.
- `ref` per model entry: the dbt model name from `ref_name_map`
  (`_dbt/__init__.py:101-121`) — `stg_<name>` / `int_<name>` / `<fct|dim>_<name>`.

### 3.3 Endpoint + use-case + JSON:API

New read use-case `get_dbt_manifest(project_id, …)` (decorator stack, `org_id`-scoped
via the project ownership check `export_dbt_project.py:46-49` already does). Returns
`DBTProjectDetails { project_name, files: DbtFileEntry[], layer_counts }`.

```jsonc
// GET /api/projects/{id}/export/dbt/manifest
{ "data": { "type": "dbt-manifests", "id": "<project_id>",
  "attributes": {
    "project_name": "acme_analytics",
    "layer_counts": { "staging": 3, "intermediate": 1, "mart": 2, "config": 7 },
    "files": [
      { "path": "models/staging/stg_patients.sql", "layer": "staging", "ref": "stg_patients" },
      { "path": "dbt_project.yml", "layer": "config" }
    ] } } }
```

### 3.4 UI mapping

Implement `metadataApiSource.getDbtFiles` mapping `attributes.files[]` →
`DbtFile[]` (1:1: `{path, layer, ref}`). `layer_counts`/`project_name` are extra and
ignored by the current `DbtFile[]` consumer (or fed to the modal header if desired —
additive). The catalog already revalidates `getDbtFiles` at construction once the
primary implements it (`client.ts:150-155`) — **no client.ts change**. Read-only,
project-scoped; note `getDbtFiles` is currently revalidated as an **org-global** getter
at construction (`client.ts:150-155`), but it is actually project-scoped — see §6 +
§7 for the scope correction.

---

## 4. UI catalog mapping — write-through for the audit toggle (Option A)

The seed fixes the write strategy: **optimistic write-through on the custom catalog**
(extend the catalog, not adopt TanStack Query). The toggle is the **first** audit/
transform write through this path. Flow:

1. **Optimistic commit.** A new catalog command `toggleAudit(nodeId, auditEntryId,
   enabled)` flips the `enabled` flag on the matching `AuditEntry` in the snapshot's
   graph (a graph reducer, mirroring the existing mutation commands
   `client.ts:266-280`) and `commit({ graph })` — instant UI feedback. Because the
   audit lives inside the `LineageGraph` aggregate
   (`LineageGraph.from(nodes, edges, audit)`, `client.ts:94,210`), the reducer adds an
   `withAuditToggled(nodeId, auditEntryId, enabled)` method to `LineageGraph`.
2. **PATCH.** Call `PATCH /api/projects/{pid}/audit/{auditEntryId}` (§2.6) via the
   injected backend client (`metadataApiSource` deps already inject `getToken` /
   `getProjectId`, `metadataApiSource.ts:60-69`).
3. **Revalidate the affected dataset's lineage/audit.** On success, re-run the
   project-scoped lineage+audit revalidation (`client.ts:205-214` already rebuilds the
   graph from `getNodes/getEdges/getAudit`) so the toggled transform's recompiled
   staging SQL/preview and the joined `enabled` flag reflect server truth. Scope it to
   the current project via the captured-pid guard (`client.ts:169-216`).
4. **Rollback on error.** The `.catch` re-commits the pre-toggle graph (snapshot the
   prior `enabled` value before step 1; on reject, `commit` the inverse reducer). This
   matches the SWR contract: a rejection keeps/repairs local state, never crashes
   (`metadataApiSource.ts` failure-vs-emptiness contract, doc-comment :28-33).

**Per-project re-scope + memo-bust.** The toggle's revalidation reuses
`revalidateScoped` (`client.ts:169-216`); every `commit` bumps the version
(`client.ts:111-119`) which is the `useSyncExternalStore` change token
(`client.ts:307-308`), so `ModelDetail` re-renders with the new audit/toggle state.
The graph-identity no-op guard (`client.ts:111-115`) ensures a no-op toggle reducer
doesn't fire a spurious render.

**Getter changes summary:**

| Getter | Change |
|---|---|
| `getOrg` | implement in `metadataApiSource` (§1.7) |
| `getAudit` | replace the `{}` stub (`metadataApiSource.ts:202-205`) with a real fetch of `GET /api/projects/{pid}/audit`, grouped by `node_id` (§2.11) |
| `getDbtFiles` | implement in `metadataApiSource` (§3.4) |

**Type/shape changes:** `AuditEntry` gains `auditEntryId?`/`transformId?`/`enabled?`
(§2.5) in `ui/src/lib/catalog/lineage.ts`; `ModelDetail.tsx:91-109` renders a toggle
when `transformId` is present; a new `toggleAudit` command + `LineageGraph`
`withAuditToggled` reducer.

---

## 5. Agent integration for `AssistantAuditEntry` persistence

- **Hook (recommended primary):** agent POSTs the full record to
  `POST /api/projects/{pid}/audit` after each successful tool execution
  (§2.7 Option A as the first cut; hybrid B+A as the hardening step). Rationale: the
  agent is the only place that holds the LLM narrative `say` and knows the exact `tool`
  ran; the transform itself already persists via its own endpoint, so a missed log on
  agent crash is a lost line, not data loss.
- **tool→tag map location:** in the agent, co-located with the tool definitions
  (`agent/lib/chat/tools.ts`, `reportToolDefinitions.ts`); promote to `shared/chat/` if
  a single SSOT is wanted (§2.8). Backend validates `tag` against `AUDIT_TAGS` at the
  inbound boundary.
- **Linking (reversed FK):** the agent **creates the tool-call record first** (`POST
  .../audit` → returns `assistant_audit_entry_id`), then includes that `assistant_audit_entry_id` in the
  transform-creating call (`POST /api/datasets/{id}/transforms` accepts an optional
  `assistant_audit_entry_id`), so the `Transform` is written pointing UP at the record. For non-
  transform tools nothing points back — the record stands alone (log-only). This ordering
  (spine first, detail second) is the general shape for any future detail type.

---

## 6. Sequencing

**Read-only first (no UI write, lowest risk):**

1. **OrgSettings** (§1) — backend columns + migration 016 + enrich `GET /api/orgs/me` +
   `metadataApiSource.getOrg`. Independent of everything. Ship anytime.
2. **DBTProjectDetails** (§3) — refactor `build_dbt_file_plan` + manifest endpoint +
   `metadataApiSource.getDbtFiles`. Independent. Ship anytime. (Also fix its
   construction-time revalidation scope, §7.)

**Then the audit write (depends on the agent + the toggle path):**

3. **`AssistantAuditEntry` read** (§2.10–2.11) — table (migration 017) + list endpoint +
   `getAudit` real fetch. Read-only; can land before any write.
4. **Agent persistence hook** (§5) — must land for the audit list to be non-empty in
   real flows. Backend read (#3) must precede it (the agent writes what #3 reads).
5. **Audit toggle write** (§2.5–2.6, §4) — the toggle endpoint + the catalog
   `toggleAudit` command + `AuditEntry`/`ModelDetail` changes. Depends on #3 (the
   `auditEntryId`/`transformId` must exist in the audit projection).

**Relative to the planned UI write slices** (W1 rename/archive/restore,
W2 view edits, W3 create):

- OrgSettings + DBTProjectDetails (#1, #2) are **read-only** — they slot in **before or
  parallel to W1**, no dependency.
- The audit toggle (#5) is its own write surface, **independent of W1–W3's resource
  writes** (it writes transform *status*, not view/report structure). It can land after
  W1 (so the optimistic-write-through plumbing in the catalog is proven on the simpler
  rename/archive/restore first), reusing the same write-through pattern. **Backend #3
  + #4 must land before the UI toggle slice #5.**

---

## 7. Risks / open questions

1. **Agent-coupling for tool-call persistence (§2.7).** Primary: pure Option A (agent
   POSTs full record) for `say`/`tag` fidelity, accepting the agent-crash missed-log
   gap; hardening: hybrid B+A. **Decision needed** on whether the missed-log gap is
   acceptable for v1.
2. **tool→tag mapping fidelity (§2.4, §2.8).** The `AUDIT_TAGS` vocabulary doesn't map
   1:1 to tool names; some tools could plausibly carry two tags. Anchor on
   `transform_id`-non-null for *toggleability* (precise) and treat `tag` as a
   display-only hint. **Open:** where the map lives (agent vs `shared/chat/`).
3. **The before/after `sample` (§2.9).** Recommended: drop from the backend-backed
   panel (fixture-only), add lazy on-demand compute later. **Decision needed.**
4. **`members[]` honesty (§1.4).** Self-only list now; real multi-member orgs need a
   membership projection fed by auth-proxy/WorkOS (a future Org↔Auth context
   integration). Stub `plan/seats/usedSeats` likewise await a billing context.
5. **node-id stability across kinds (§2.3).** `AssistantAuditEntry.node_id` references a
   lineage node whose id namespace spans dataset/view/report; the UI graph keys nodes by
   id (`lineage.ts:99-102`). `node_kind` disambiguates, but if a node is deleted/
   recreated its id changes and the audit orphans. Confirm node-id stability
   guarantees (the lineage graph is *derived* client-side from resource lists,
   `metadataApiSource.ts:121-146`, so node ids = backend resource ids = stable).
6. **Recompile cost on toggle (§2.5).** Each toggle re-runs `build_staging_sql` and the
   revalidation re-fetches the project's datasets/views/reports
   (`client.ts:205-214`). For large projects this is a full lineage refetch per toggle.
   Mitigation: scope the post-toggle revalidation to the affected node's audit only
   (a narrower `getAudit`-for-node fetch) rather than the whole graph — a follow-up
   optimization if toggle latency bites.
7. **`getDbtFiles` revalidation scope (§3.4).** It's revalidated as an **org-global**
   getter at catalog construction (`client.ts:150-155`), but the manifest is
   **project-scoped**. Either move it into `revalidateScoped` (project-scoped, like the
   lineage triple) or accept first-project-only at construction. **Recommend** moving it
   project-scoped to match the others — a small `client.ts` change, the only one this
   feature needs.
8. **JSON:API attribute casing.** Backend emits snake_case (`used_seats`,
   `model_prefix`, `transform_id`); the `metadataApiSource` mappers must camel-case at
   the boundary (existing mappers already do this kind of translation,
   `metadataApiSource.ts:75-83`). Low risk, just discipline.
