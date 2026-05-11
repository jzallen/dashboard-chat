# CEL for Deterministic ibis-driven SQL Construction in the Agent Loop

**Date:** 2026-05-11
**Audience:** Decision-makers considering tightening agent-driven SQL determinism
**Status:** Research input — no production code changes, no ADR
**Scope:** Evaluate whether Google's Common Expression Language (CEL) would meaningfully constrain how the dashboard-chat agent constructs SQL through ibis, and whether it would help validate the dataset / view / report tier rules.

---

## 1. Question

The dashboard-chat agent loop (Hono worker → backend) builds SQL transforms for users via natural-language prompts. The worker dispatches structured tool calls; the backend translates payloads into ibis expressions for the staging tier. Agent-driven SQL construction is non-deterministic by nature — same prompt, different LLM output across runs. The user is asking three linked questions:

1. **How is ibis currently used in conjunction with the agent's tools** for building deterministic SQL models? What is the seam between the LLM's tool calls and ibis expression construction?
2. **Would CEL be helpful for decision logic about which ibis utility to use during SQL construction** — e.g. as a typed rule layer that constrains "if column is text and constraint says non-null, use `ibis.<op>` X; if numeric and range, use `ibis.<op>` Y"?
3. **Would CEL help validate that a constructed model adheres to data-layer limits** — staging (one source; filter / rename / cast), view (joins between staging tables), report (aggregations over views)?

The end-state the user articulated: "scope the agent to use ibis to build whatever it needs, but keep the SQL construction process as deterministic as possible." CEL is one candidate. The recommendation must be one of: **ADOPT_CEL**, **ADOPT_SIMPLER**, **DEFER**, or **REJECT**.

---

## 2. Findings — Codebase

### 2.1 ibis surface (narrow)

ibis appears in **three** backend modules and zero frontend / worker modules:

- `backend/app/models/dataset_sql.py:21` — the staging-tier SQL compiler. Implements the design-D3 pipeline **MUTATE → FILTER → RENAME** (`apply_cleaning_mutations` :101, `apply_filter_predicates` :114, `apply_alias_renames` :126) against a synthetic `ibis.table(schema, name=...)` and emits SQL via `ibis.to_sql(table, dialect="duckdb")`. ibis is used **as a compiler only** — no execution.
- `backend/app/types.py:39,189` — two value objects translate JSON tool-call payloads into ibis expressions:
  - `QueryBuilderJSON.as_ibis_filter` (`:34`) — converts RAQB JSON to a `ibis.expr.types.BooleanValue` via a `match operator:` block of ~17 cases (`:79-117`).
  - `CleaningExpression.as_ibis_expr` (`:179`) — converts an `expression_config` dict to a column expression via `match self.operation:` over `trim | case | fill_null | map_values | alias` (`:195-223`), with a nested `match mode:` for case operations.
- `backend/app/utils/sql_functions.py:66` — lazy-declares three ibis `@ibis.udf.scalar.builtin` UDFs (`title_case`, `snake_case`, `kebab_case`) that map to DuckDB macros.

ADR-007 (`docs/decisions/adr-007-ibis-for-sql-generation.md`) ratifies ibis specifically for **dialect-agnostic compilation** of the staging pipeline; nothing more.

### 2.2 Agent → ibis seam (the LLM never constructs ibis)

The agent does **not** construct ibis expressions. The seam is JSON, not Python objects.

- The Hono worker exposes Zod-typed tools at `agent/lib/chat/tools.ts` (dataset operations), `agent/lib/chat/viewToolDefinitions.ts` (view operations), and `agent/lib/chat/reportToolDefinitions.ts` (report operations). Each tool's `parameters` is a Zod schema with closed enums for operations, columns, and operators (e.g. `tools.ts:38-42` builds a `colEnum` from the live schema; `viewToolDefinitions.ts:17-39` declares `JOIN_TYPES`, `FILTER_OPERATORS`, `MATERIALIZATION_STRATEGIES`).
- Dispatchers in `agent/lib/chat/dispatchers/cleaning.ts:41-80` (`dispatchCleaningCall`) and `agent/lib/chat/dispatchers/mutations.ts` `POST` a normalized `expression_config` JSON payload to the backend's transforms endpoint. Example payload: `{operation: "case", mode: "snake", ...config}` (`cleaning.ts:31-39`, `expressionConfigFor`).
- The backend receives that JSON and runs it through `CleaningExpression.as_ibis_expr` (`backend/app/types.py:195-223`), which is the **only** place LLM tool output becomes ibis. The mapping is a closed `match` statement with **8 operations** and **5 case modes** — a closed, statically-known set of branches.

The agent therefore lives at a **JSON-call boundary**, not at an ibis API boundary. The LLM's freedom is bounded by Zod enums on the way in and by Python `match` arms on the way out.

### 2.3 Views and reports do not use ibis

This is important and is the kind of finding that disconfirms a simplistic version of the user's premise:

- `backend/app/use_cases/view/sql_generator.py` (162 lines) builds view SQL by **string concatenation** — `_build_select` (`:106`), `_build_from` (`:120`), `_build_joins` (`:130`), `_build_where` (`:146`). No ibis involvement.
- `backend/app/use_cases/report/create_report.py` takes `sql_definition: str` as a raw SQL parameter (`:23,77`). The agent emits the SQL string directly (see `agent/lib/chat/reportToolDefinitions.ts:58` — `sqlDefinition: z.string()`).
- "ibis-defined data-layer boundaries" in the user's framing is therefore only literally true at the **staging tier**. The view and report tiers have their own determinism mechanisms (string templates and free-form SQL strings respectively).

### 2.4 Determinism today — four layers

Determinism is enforced today at four distinct layers, in order from agent-facing inward:

1. **Zod schemas on TS tool inputs** — `agent/lib/chat/tools.ts`, `viewToolDefinitions.ts:17-39`, `reportToolDefinitions.ts:4-49`. Closed enums for operations, operators, join types, time granularities, semantic roles/types. The LLM cannot emit an unknown operator or pick a non-text column for a text-only op because the column enum is built from the live schema (`tools.ts:27-41`).
2. **Python `match` statements** — `backend/app/types.py:79-117,195-223`. Closed-world mapping from JSON keys to ibis methods. A typo crashes; a missing case returns `None` and is treated as a no-op filter.
3. **Hand-coded Python validators** — `backend/app/use_cases/report/column_validation.py:9-13,26-50`. `VALID_TYPES_BY_ROLE = {"entity": {"primary", "foreign", "unique"}, "dimension": {"categorical", "time"}, "measure": {"sum", "count", "count_distinct", "avg", "min", "max"}}`. Plain dict + `raise InvalidColumnMetadata`. Reports also enforce "no mart-to-mart deps" via `if any(ref.get("type") == "report" for ref in refs): raise InvalidReportReference()` (`create_report.py:62-63`).
4. **Pandera** (per ADR-019) — per-turn staging-DataFrame schema validation against the in-flight transform output. Lives at `tests/integration/dataset_layer/validation/pandera_validator.py`.

### 2.5 Data-layer-tier rule — exists but is encoded as **prompt text**

This is the most interesting finding for the user's third question.

- The canonical definition of the three tiers lives in **ADR-015** (`docs/decisions/adr-015-headless-presentation-state-retrieval.md:20-24`):
  - **dataset** = source (S3/MinIO) + staging SQL query (effectively a SQL view).
  - **view** = intermediate dbt layer where joins happen.
  - **report** = aggregation layer (sum / avg / rollups / window functions), intended for end-consumer dashboards.
- Tier rules are encoded in the **system prompt** at `agent/lib/chat/prompts.ts:556-594` in the function `getLayerSection`. The dataset branch reads, verbatim: *"ALLOWED operations: Column cleaning (trim, case, fill nulls, map values), filtering, sorting, column renaming. PROHIBITED: JOINs, GROUP BY, aggregate functions (SUM, COUNT, AVG, etc.), window functions, subqueries. These belong in a View (intermediate layer)."*
- This is **suggested**, not **enforced**. There is no Python or TypeScript code that validates "this is a staging-tier query and contains no JOIN keyword" before the SQL ships. The Zod schemas constrain the *tool* surface (datasets have no `addJoin` tool), but a raw SQL field on a report (`sqlDefinition: z.string()`) is unchecked, and a view's SQL is generated by string templates that don't know which tier they're emitting for.

This is the gap CEL could potentially close — moving tier rules from prompt text into enforced code.

---

## 3. Findings — External (CEL + alternatives)

### 3.1 What CEL is and is not

CEL (Common Expression Language) is a Google-designed expression language for embedding constrained predicate logic inside hosts that need to evaluate user-supplied or operator-supplied rules safely. Its design constraints are deliberate: **non-Turing-complete, mutation-free, linear-time evaluation, hermetic** (cannot read data the host has not explicitly bound). The cel-spec README states "CEL evaluates in linear time, is mutation free, and not Turing-complete" and frames the lack of Turing-completeness as "a feature of the language design" that enables it to run "orders of magnitude faster than equivalently sandboxed JavaScript" [1]. The cel.dev landing page positions evaluation latency in **"nanoseconds to microseconds"** with predictable costs, intended for "high-frequency evaluation with infrequent modifications" — for example, evaluating each HTTP request against a security policy [2].

The intended use cases are narrow and consistent across sources: **list filtering, protobuf-constraint validation, authorization predicates, simple data transformations** [2]. CEL is explicitly *not* designed to build recursive data structures, perform mutation, or replace a general-purpose programming language. It accesses **only** data provided by the host.

### 3.2 Production deployments

CEL is widely deployed in safety-critical control planes:

- **Kubernetes** — `ValidatingAdmissionPolicy`, CRD `x-kubernetes-validations` schemas. The Kubernetes docs state CEL expressions "are evaluated directly in the API server, making CEL a convenient alternative to out-of-process mechanisms, such as webhooks" and enforce **runtime cost budgets and estimated cost limits** to bound API-server impact [3].
- **GCP IAM Conditions** — uses a *subset* of CEL with three attribute namespaces (`resource`, `request`, `principal`) for attribute-based access control [4]. Example: `resource.service == 'storage.googleapis.com' && resource.name.startsWith('projects/_/buckets/example')`.
- **Cloud Armor**, **Envoy Proxy** (RBAC and routing decisions), **Firebase Rules** (the spec itself was informed by Firebase Rules usability testing) [5][1].

### 3.3 CEL in Python — important 2026 development

There are now **three** Python CEL implementations, and the landscape changed in March 2026:

1. **cel-python (cloud-custodian)** — pure-Python, the de facto incumbent. Latest release **v0.5 on 2025-01-31** with roughly biannual cadence [6]. **13 open issues**, including 3 bugs (compiled-runner bug #145, type-coercion ordering #114) and an outstanding enhancement to "upgrade to latest CEL spec" (#64), plus an incomplete `has` macro (#73) [7]. Positioned as part of Cloud Custodian's policy filter; **not** widely cited as a general-purpose runtime. No published benchmarks.
2. **cel-expr-python (Google, official)** — announced **2026-03-03** on the Google Open Source Blog [8] and covered by InfoQ [9]. Wraps Google's official **C++** CEL implementation via Python bindings; "any future improvements to the C++ core … will automatically be inherited." Critically, **launched read-only** — Google states it is "not accepting external contributions at this moment." This is a **preview release**, not a stability commitment. Repo: https://github.com/cel-expr/cel-python [10].
3. **common-expression-language (community, Rust-backed via PyO3)** — claims **80% spec compliance, 200+ tests, ~10–20× speedup over pure-Python CEL**, "ready for production" per its own docs [11]. Performance claims are self-reported and not independently audited.

### 3.4 Alternatives

**OPA / Rego** — a CNCF Graduated project, but "primarily designed as a separate policy service," typically deployed as `opa run --server` on localhost:8181 or embedded as a Go library; in-process Python is not its native deployment model [12]. Rego is more powerful (Datalog-like, supports referential constraints, external data joins) but has a steeper learning curve. Community comparisons converge on: **"Choose CEL for simpler admission policies … Choose Rego when you need complex logic, referential constraints, access to external data"** [13].

**Pydantic v2 validators** — `@field_validator` (4 modes: before / after / plain / wrap) and `@model_validator` (3 modes) provide cross-field validation via `ValidationInfo.data` [14]. The decisive feature for the case-at-hand is **discriminated unions**: tagged unions with a `Literal` discriminator field perform a direct map lookup, bypassing the smart-union scoring path — Pydantic explicitly markets them as "the highest level of optimization" for tagged-variant validation [15].

**JSON Schema / AJV** — sufficient for shape validation but cannot express "if column type is text, operation must be Y" without `if / then / else` or `oneOf` discrimination, which becomes brittle at the same complexity threshold that motivates Pydantic discriminated unions.

**Plain Python `match` + closed-world dicts** — the codebase's status quo. No runtime overhead, no DSL, but rules are entangled with the code that maps to ibis.

---

## 4. Analysis

### 4.1 Q1 — Would CEL help constrain "which ibis op to call" decisions?

**No, with high confidence.** CEL is designed to **gate** decisions, not to **make** them. The codebase's "which-op" decision tree is a **closed, statically-known** set: 8 cleaning operations × 5 case modes (≈40 leaves), plus ~17 RAQB operator cases at `backend/app/types.py:79-117`, all driven by Zod-validated JSON tool calls. The Python `match operation:` block at `backend/app/types.py:195-223` already does this work in **one place** with type-checker support. Replacing it with CEL would mean:

- Lifting the decision rules into CEL strings stored… where? CEL only shines when rules change without code edits or must be shared across languages. Neither applies — the rules change when ibis changes.
- Losing static-typing checks on each branch's return value (a CEL boolean can't help you construct an `ibis.Expr`).
- Adding a runtime — either the read-only `cel-expr-python` preview, the maintenance-light `cel-python` (last release 2025-01-31, 13 open issues including a spec-version gap), or a self-reported community Rust binding.

A **Pydantic v2 discriminated union** over `Annotated[Union[TrimOp, CaseOp, FillNullOp, MapValuesOp, AliasOp], Field(discriminator='operation')]` is the canonical, type-safe expression of this decision tree and the standard answer in 2026 [15]. The Zod layer already does the TypeScript-side half of this dispatch (`agent/lib/chat/tools.ts:97-99`).

### 4.2 Q2 — Would CEL help validate tier rules?

**Marginally helpful, but the rule corpus is too small to justify a new runtime.** This is the question where CEL has the strongest theoretical fit — language-agnostic, hermetic predicate evaluation over a normalized payload — and the question where the codebase has the largest **actual gap** (tier rules currently exist only as prompt text at `agent/lib/chat/prompts.ts:556-594`).

**Worked example** — a CEL rule restricting staging from JOIN, given a normalized query AST as `query`:

```cel
// CEL rule for tier=='dataset'
query.layer == 'dataset'
  && size(query.joins) == 0
  && size(query.aggregations) == 0
  && size(query.window_functions) == 0
  && !query.has_semantic_annotations
```

**Contrast 1** — today, in `agent/lib/chat/prompts.ts:566-567`, this is a natural-language string in the LLM system prompt: *"PROHIBITED: JOINs, GROUP BY, aggregate functions (SUM, COUNT, AVG, etc.), window functions, subqueries."* Not enforced — hoped for.

**Contrast 2** — as a Pydantic v2 model:

```python
class DatasetQuery(BaseModel):
    layer: Literal['dataset']
    operations: list[StagingOp]  # closed enum: cleaning, filter, sort, rename

    @model_validator(mode='after')
    def reject_intermediate_ops(self):
        forbidden = {'join', 'group_by', 'window', 'subquery'}
        if any(op.kind in forbidden for op in self.operations):
            raise ValueError(f"dataset layer forbids {forbidden}")
        return self
```

**Contrast 3** — as a plain assertion against a closed dict (matches the existing pattern at `column_validation.py:9-13`):

```python
ALLOWED_OPS_BY_TIER = {
    'dataset': {'cleaning', 'filter', 'sort', 'rename'},
    'view':    {'cleaning', 'filter', 'sort', 'rename', 'join', 'group_by', 'window', 'cte', 'union', 'case'},
    'report':  '*',
}
if ALLOWED_OPS_BY_TIER[tier] != '*' and operation.kind not in ALLOWED_OPS_BY_TIER[tier]:
    raise InvalidTierOperation(tier, operation.kind)
```

All three encode the same fact. The CEL version is **language-agnostic** — it could be evaluated identically from TypeScript (Zod-rejection at the worker boundary) and Python (last-line-of-defence at the backend). That is the one real win. But the codebase already has the inverse arrangement working (Zod on TS, Python `match` and closed-world `VALID_TYPES_BY_ROLE` dicts on the backend). With only **3 tiers** and ~10 allowed ops each, the rule corpus is ~30 leaves. A CEL runtime — especially given Python-side CEL maturity in 2026 — is overhead for a problem that fits in 20 lines.

The deeper issue is structural: **ibis expressions are recursive trees, and CEL has no recursion or first-class abstractions.** CEL cannot traverse an `ibis.Expr` to verify "no JOIN appears anywhere in this subtree." You would have to flatten the query into a denormalized fact bag first (`{layer, joins: [...], aggs: [...], has_semantic: bool}`), and once you've done that flattening, a dict lookup is sufficient. CEL is the **right tool for gating, not for tree-walking**.

### 4.3 Q3 — CEL or simpler bespoke validator?

**Simpler bespoke validator.** The codebase already has four determinism layers (Zod, Python `match`, hand-coded validators, Pandera). The gap that CEL would close — *enforced* tier rules currently only existing as prompt-text — is real, but the fix is **promoting the prompt-text rules into a typed Pydantic model** that backs the same tool-call dispatch, not introducing a fifth DSL. CEL's value proposition (language-agnostic, hermetic, sandboxed evaluation of operator-supplied rules) only pays back when (a) the rules change outside code releases or (b) the same rule must execute identically across languages. Neither is true here: tier rules change with `getLayerSection` edits, and TS-side enforcement is already handled by Zod.

### 4.4 Note on the user's premise — partially disconfirmed

The user framed the question as "agent uses ibis to build SQL → CEL constrains which ibis utility." The codebase does not work that way at the **view** or **report** tiers, only at the **staging** tier. View SQL is built by string concatenation in `sql_generator.py`; report SQL is a free-form string from the agent. So the literal framing ("CEL guards ibis utility selection") only applies to staging — and at the staging tier the decision tree is small enough (8 ops, 5 modes) to fit in a `match` statement. The user's deeper concern — *deterministic boundaries on agent-generated SQL* — is valid, but the leverage point is **the tier-rule layer**, not the ibis-selection layer. Section 5 picks the fix at that layer.

---

## 5. Recommendation

**ADOPT_SIMPLER** — promote the natural-language tier rules in `agent/lib/chat/prompts.ts:556-594` into a **Pydantic v2 discriminated-union model** (or a `Literal['dataset' | 'view' | 'report']`-keyed dict of allowed-ops sets), and enforce it at the backend tool-call and SQL-emission boundaries.

**Why not CEL.** The rule corpus is small (~30 leaves), closed, and changes only when ibis or the tier definitions change — code edits are the right artifact. Python CEL is uneven in 2026: the cloud-custodian implementation is maintenance-light with a stale spec version [6][7]; Google's official wrapper is **read-only preview** as of March 2026 and not accepting external contributions [8][10]; the Rust-backed community port is unaudited [11]. None of these are inappropriate for production *gating* logic of this size on their own merits, but adding a fifth DSL on top of four already-working determinism layers buys little. ibis expressions are also recursive trees, and CEL's no-recursion design rules it out for tree-walking the query itself — any CEL-based check would require flattening the query first, at which point a dict lookup is enough.

**Why not REJECT.** The tier-rule gap is real. The dataset / view / report taxonomy is enforced today only as prompt text. A motivated LLM (or a buggy worker dispatch) can violate the contract without any code-layer rejection. The fix is small but worth doing.

**Why not DEFER.** Deferring would leave the prompt-text gap unaddressed. The simpler fix is bounded and proportionate; there is no reason to wait.

**Proposed integration shape** (this is the *what*, not a commitment to *when* — that is a separate dispatch):

1. **`backend/app/domain/tier_policy.py`** — new module declaring `ALLOWED_OPS_BY_TIER` and `FORBIDDEN_FEATURES_BY_TIER` as typed `frozenset[str]` values, plus a `validate_tier_policy(tier: Literal['dataset', 'view', 'report'], normalized_query: NormalizedQuery) -> None` function that raises a domain exception. Mirrors the existing pattern at `backend/app/use_cases/report/column_validation.py:9-50`.
2. **Convert `QueryBuilderJSON` and `CleaningExpression`** (currently plain classes at `backend/app/types.py:20-117,120-267`) into Pydantic v2 models with a `kind` discriminator. Drop the open-coded `match operation:` mapping in favour of Pydantic-generated validation + a thin dispatch table inside each variant. Preserves the ibis-construction logic in branch bodies (`as_ibis_expr`, `as_ibis_filter`); does not change the wire format.
3. **Call `validate_tier_policy(...)` from `dataset_sql.py`, `sql_generator.py`, and the report `sql_definition` ingest path** *before* SQL is emitted. For reports, this requires a minimal SQL classifier (`has_join`, `has_aggregate`, `has_window`) — likely sqlglot or a regex pass; out of scope for this research doc.
4. **Mirror the same allowed-ops set in TypeScript Zod schemas** in `agent/lib/chat/viewToolDefinitions.ts` and `reportToolDefinitions.ts` so the agent gets rejected at the worker boundary, not only on the round-trip. The staging-tier tool surface (`agent/lib/chat/tools.ts`) already implicitly enforces this by not exposing join / aggregate tools.

Defer CEL until a future requirement appears that genuinely needs **cross-language rule sharing** — for example, a multi-tenant rule editor where operators author tier rules at runtime, or a Go-based downstream consumer enforcing the same rules. At that point, prefer Google's `cel-expr-python` once it leaves read-only status.

---

## 6. References

[1] Google. "cel-spec — Common Expression Language specification." GitHub. https://github.com/google/cel-spec. Accessed 2026-05-11. (Tier: High — official.)

[2] Google. "CEL — Common Expression Language." cel.dev. https://cel.dev/. Accessed 2026-05-11. (Tier: High — official.)

[3] Kubernetes Authors. "Common Expression Language in Kubernetes." https://kubernetes.io/docs/reference/using-api/cel/. Accessed 2026-05-11. (Tier: High — official, evergreen for in-tree feature.)

[4] Google Cloud. "IAM conditions overview." https://docs.cloud.google.com/iam/docs/conditions-overview. Accessed 2026-05-11. (Tier: High — official.)

[5] ARMO. "What is Common Expression Language (CEL)?" https://www.armosec.io/glossary/common-expression-language-cel/. Accessed 2026-05-11. (Tier: Medium — vendor glossary, cross-referenced.)

[6] cloud-custodian. "cel-python releases." https://github.com/cloud-custodian/cel-python/releases. Accessed 2026-05-11. (v0.5 latest; ~biannual cadence.) (Tier: High — primary source.)

[7] cloud-custodian. "cel-python issue tracker." https://github.com/cloud-custodian/cel-python/issues. Accessed 2026-05-11. (13 open issues incl. #114, #145, #64, #73.) (Tier: High — primary source.)

[8] Google Open Source Blog. "Announcing CEL-expr-python: the Common Expression Language in Python, now open source." 2026-03-03. https://opensource.googleblog.com/2026/03/announcing-cel-expr-python-the-common-expression-language-in-python-now-open-source.html. Accessed 2026-05-11. (Tier: High — official; release is **read-only preview**.)

[9] InfoQ. "Google Open-Sources the Common Expression Language for Python." 2026-03. https://www.infoq.com/news/2026/03/google-cel-expr-python/. Accessed 2026-05-11. (Tier: Medium-High — industry reporting.)

[10] Google. "cel-expr-python." https://github.com/cel-expr/cel-python. Accessed 2026-05-11. (Tier: High — official repo.)

[11] Python CEL community port. "Python CEL — Common Expression Language." https://python-common-expression-language.readthedocs.io/. Accessed 2026-05-11. (Tier: Medium — community, self-reported benchmarks not independently verified.)

[12] Open Policy Agent. "OPA documentation." https://www.openpolicyagent.org/docs/latest/. Accessed 2026-05-11. (Tier: High — CNCF Graduated project.)

[13] Permit.io. "Policy as Code: OPA's Rego vs. Cedar." https://www.permit.io/blog/opa-vs-cedar. Accessed 2026-05-11. (Tier: Medium — vendor-adjacent comparison, used only for the CEL-vs-Rego rule of thumb.)

[14] Pydantic. "Validators concept docs." https://pydantic.dev/docs/validation/latest/concepts/validators/. Accessed 2026-05-11. (Tier: High — official.)

[15] Pydantic. "Unions concept docs — Discriminated unions." https://pydantic.dev/docs/validation/latest/concepts/unions/. Accessed 2026-05-11. (Tier: High — official.)

**Codebase citations** (all paths relative to repo root):

- `agent/lib/chat/tools.ts:27-41,97-99` — Zod tool surface for the staging tier.
- `agent/lib/chat/viewToolDefinitions.ts:17-39,72-91` — Zod tool surface for the intermediate tier.
- `agent/lib/chat/reportToolDefinitions.ts:4-49,58,67` — Zod tool surface for the mart tier.
- `agent/lib/chat/dispatchers/cleaning.ts:31-39,41-80` — `expressionConfigFor`, `dispatchCleaningCall`.
- `agent/lib/chat/prompts.ts:556-594` — `getLayerSection`; tier rules as prompt text.
- `backend/app/types.py:34,79-117,179,195-223` — JSON → ibis seam.
- `backend/app/models/dataset_sql.py:21,44-98,101-137` — staging-SQL compiler.
- `backend/app/use_cases/view/sql_generator.py:11-162` — view SQL by string concatenation (no ibis).
- `backend/app/use_cases/report/create_report.py:23,62-63,77` — report SQL ingest (free-form string + `InvalidReportReference`).
- `backend/app/use_cases/report/column_validation.py:9-13,26-50` — `VALID_TYPES_BY_ROLE` validator pattern to mirror.
- `docs/decisions/adr-007-ibis-for-sql-generation.md` — ibis ratification.
- `docs/decisions/adr-015-headless-presentation-state-retrieval.md:20-24` — canonical tier definitions.
- `docs/decisions/adr-019-eject-then-test-validation.md` — Pandera per-turn validation layer.

---

## 7. Knowledge gaps

- **No independent benchmark** comparing cel-python (cloud-custodian) vs cel-expr-python (Google C++ wrapper) vs the Rust-PyO3 community port on Python-side latency. Performance claims for the latter two are self-reported.
- **cel-expr-python's stability roadmap is unknown** — Google stated only that contributions will open "in the future." Any production adoption inherits preview-status risk.
- **No adoption data on cel-python in Python data-validation pipelines** outside Cloud Custodian itself.
- **Out of scope here:** the exact SQL classifier (regex vs sqlglot vs custom) the report path would need to enforce tier policy on a raw SQL string. That belongs in the design dispatch that follows this research, if the recommendation is accepted.
