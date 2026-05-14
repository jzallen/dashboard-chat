# Developer Journey: "I need to force a specific failure in a new acceptance scenario"

DISCUSS-wave deliverable. The user of this journey is **Devon**, a backend/full-stack engineer writing or modifying an acceptance scenario in `tests/acceptance/project-and-chat-session-management/` (or future suites). This is a *developer experience* journey, not an end-user journey — the artifacts emitted are pytest fixtures and assertions, not UI screens.

## Vocabulary note

The category term for the mechanism this journey describes is **fault injection** — industry-standard terminology (Istio, AWS FIS, chaos engineering). The previously-used word "harness" was overloaded across at least six distinct concepts in the codebase and is retired from the category vocabulary. Specifically:

- **fault-injection registry** — the consolidated module
- **fault-injection knob** — one specific lever
- **fault-injection manifest** — the canonical list (file: `fault-injection.manifest.ts`)
- **inspection probes** — the read-only `/debug/*` observability endpoints (a *different* category from fault injection; same ENVIRONMENT gate)

The TS test-runner directory `tests/acceptance/user-flow-state-machines/harness/` ("UserFlowHarness") is unchanged — it's a proper noun, not a generic descriptor.

The `NWAVE_` prefix on env vars is being retired in US-CONSOL-4. nwave-ai is the SDLC tool that drives this codebase; it is not part of the system under development.

## Persona

**Devon Park** — Backend engineer, 18 months on dashboard-chat. Comfortable in TypeScript and Python. Has written ~6 acceptance scenarios in this codebase but has never needed to add a brand-new fault-injection knob. Today's task: scenario for US-209 (hypothetical), which needs `POST /api/projects/{id}/sessions` to return 5xx exactly once mid-flow.

## Journey Goal

Author one new acceptance scenario that depends on a specific port-boundary failure. Ship the MR via `gt mq submit`. Confidence: "I know what I changed, I know nothing else moved, I know production cannot accidentally trigger this."

---

## Emotional Arc

| Phase | Devon's state today (pre-consolidation) | Devon's state after consolidation |
|---|---|---|
| 1. Identify needed knob | Frustrated — three conventions, three locations, must grep | Curious — opens one manifest file |
| 2. Discover whether it exists | Anxious — "did I miss one?" Also: "wait, which 'harness' is this?" | Confident — manifest is canonical; vocabulary is unambiguous |
| 3. Wire scenario to knob | Cautious — copy-paste from a prior scenario | Smooth — manifest entry shows the canonical name |
| 4. Run suite locally | Hopeful — fingers crossed | Calm — audit log shows exactly which knobs fired |
| 5. Submit MR | Tense — "did I leave a knob enabled in prod by accident?" | Confident — ENVIRONMENT gate is structural, not a checkbox |
| 6. Review feedback | Defensive — reviewer asks "why a knob and not a contract test" with no shared vocabulary | Constructive — manifest rationale field anchors the conversation |

The arc: **frustration → relief → confidence**. Each phase has a concrete design lever pulled from one of US-CONSOL-1..5.

---

## Journey Map

### Step 1: Devon needs a deterministic failure

```
+-- Step 1: Identify needed failure --------------------------------+
| Trigger: pytest fixture for US-209 needs                          |
|   "POST /api/projects/proj-42/sessions" to 5xx once.              |
|                                                                    |
| Devon asks himself:                                                |
|   "Is there already a knob for this? Or do I need to add one?"    |
|                                                                    |
| Today:                                                             |
|   grep -r "X-Force-" ui-state/                                    |
|   grep -r "__harness_" ui-state/                                  |
|   grep -r "harness_force_" ui-state/                              |
|   ... three different conventions, three different greps.        |
|   ... and the word "harness" turns up six unrelated things        |
|       (TS UserFlowHarness, debug endpoints, env-var gate, ...).  |
|                                                                    |
| After consolidation:                                               |
|   $ cat shared/fault-injection/manifest.ts   # one file            |
|   force-create-session-failure  | header  | createSession          |
|   force-list-sessions-failure   | header  | listSessions           |
|   force-create-project-failure  | header  | createProject          |
|   force-reissue-failures        | body    | begin                  |
|   force-failure-tag             | event   | login-and-org-setup    |
|   expire-token                  | event   | login-and-org-setup    |
+-------------------------------------------------------------------+
```

**Feels**: Today, frustrated and uncertain ("am I about to duplicate an existing knob? and which 'harness' is this codebase even talking about?"). After, curious and oriented ("I see the whole surface in one place, with one unambiguous category name").

**Friction (today)**: three conventions, three search locations, one overloaded word.
**Friction (after)**: one file open, ctrl-F.

**Design lever**: US-CONSOL-1 (unified manifest + retired "harness" descriptor).

---

### Step 2: Devon decides between using an existing knob vs adding a 7th

```
+-- Step 2: Reuse or add? ------------------------------------------+
| Devon sees `force-create-session-failure` in the manifest.       |
| It targets exactly the port boundary he needs.                   |
|                                                                   |
| Today:                                                            |
|   No clear way to know if this knob fits — must read the         |
|   production code to confirm its semantics.                      |
|                                                                   |
| After consolidation:                                              |
|   Manifest entry:                                                |
|     name: "force-create-session-failure"                         |
|     transport: "header"                                          |
|     header: "X-Force-Create-Session-Failure"                     |
|     target: "createSessionEagerlyFn (session-chat.ts)"           |
|     owning_service: "ui-state"                                   |
|     rationale: "US-206: lazy new-session lifecycle error case"  |
|     contract_test_alternative_considered: false                  |
|     gate:                                                         |
|       dev: permit                                                |
|       ci: permit                                                 |
|       staging: deny                                              |
|       production: deny                                           |
+-------------------------------------------------------------------+
```

**Feels**: Today, lost in the codebase. After, the manifest tells him whether the existing knob fits without reading machine code.

**Friction (today)**: must read `session-chat.ts:920-940` to verify semantics.
**Friction (after)**: manifest's `target` and `rationale` answer the question.

**Design lever**: US-CONSOL-1 + US-CONSOL-5 (rationale field).

**Decision point**: Devon decides to reuse the existing knob. The 7th-knob branch of this journey is covered separately in step 2b below.

---

### Step 2b (alternate): Devon needs a brand-new knob

```
+-- Step 2b: Adding a 7th knob ------------------------------------+
| Devon's case isn't covered by any existing knob.                  |
|                                                                    |
| Today:                                                             |
|   He picks a convention (header? event? body field?) by feel.     |
|   No checklist, no review prompt for "why a knob and not a       |
|   contract test?"                                                  |
|                                                                    |
| After consolidation:                                               |
|   1. Edit shared/fault-injection/manifest.ts                       |
|   2. Schema validation requires:                                  |
|        - rationale: non-empty                                     |
|        - contract_test_alternative_considered: explicit bool      |
|   3. CI lint check: production-code reference to a knob name      |
|      without a manifest entry => build fails.                     |
|   4. Reviewer sees the manifest entry in the diff and asks        |
|      about the rationale — the conversation happens by default.   |
+-------------------------------------------------------------------+
```

**Feels**: Today, sneaky ("I can just slip this in"). After, deliberate ("I have to think about whether this is right").

**Friction (today)**: zero — and that's the problem.
**Friction (after)**: schema validation + lint check + reviewer prompt = three small frictions that compose into a deliberate decision.

**Design lever**: US-CONSOL-5 (sprawl friction).

---

### Step 3: Devon wires the scenario

```
+-- Step 3: Author the pytest scenario -----------------------------+
| Devon's fixture:                                                  |
|                                                                    |
|   resp = client.post(                                             |
|     "/api/projects/proj-42/sessions",                             |
|     headers={"X-Force-Create-Session-Failure": "transient"},      |
|   )                                                                |
|   assert resp.status_code == 500                                  |
|                                                                    |
| The wire contract is unchanged from pre-consolidation, so this    |
| step looks identical. The difference is that Devon got here in    |
| 2 minutes instead of 15.                                           |
|                                                                    |
| Note: `X-Force-*` headers are deliberately kept (DISCUSS Q4).     |
| Only `__harness_*` events and `harness_force_reissue_failures`    |
| body field are renamed in US-CONSOL-4 phase 2.                    |
+-------------------------------------------------------------------+
```

**Feels**: Calm. The header wire contract is byte-identical pre/post consolidation; Devon's muscle memory works.

**Friction**: none added.

**Design lever**: US-CONSOL-4 (migration preserves header wire contract).

---

### Step 4: Devon runs the suite locally

```
+-- Step 4: Local validation ---------------------------------------+
| $ cd tests/acceptance/project-and-chat-session-management        |
| $ uv run --no-project pytest tests/test_us209.py                 |
|                                                                    |
| Today:                                                             |
|   Scenario passes. Devon doesn't know which knobs actually fired. |
|   If it failed, he'd add console.log to session-chat.ts.          |
|                                                                    |
| After consolidation:                                               |
|   Pytest output shows the relevant audit log lines:               |
|     fault-injection.fired                                         |
|       name=force-create-session-failure                           |
|       transport=header env=dev cid=abc-123 ts=2026-05-14T10:42:00Z |
|                                                                    |
|   If scenario fails, Devon greps the log for                      |
|   `fault-injection.fired` and immediately sees which knobs        |
|   fired or didn't.                                                 |
+-------------------------------------------------------------------+
```

**Feels**: Today, hopeful but blind. After, calm — the audit log makes fault-injection firings first-class observable events.

**Friction (today)**: debugging a flaky scenario is a 30-minute archaeology session.
**Friction (after)**: one grep on `fault-injection.fired` answers "did the knob fire?".

**Design lever**: US-CONSOL-3 (audit log).

---

### Step 5: Devon submits the MR

```
+-- Step 5: gt mq submit -------------------------------------------+
| $ git commit -m "feat(acceptance): US-209 deterministic 5xx..."   |
| $ gt mq submit                                                    |
|                                                                    |
| Refinery rebases onto main, runs `./tools/test/test.sh --auto`,   |
| merges on green.                                                  |
|                                                                    |
| Today:                                                             |
|   Devon worries: "did I leave NWAVE_HARNESS_KNOBS=true            |
|   anywhere that ships to staging?" He greps. He worries some      |
|   more. The boolean is the only safety net. Also: he wonders       |
|   why the env var has 'NWAVE_' in it — that's the SDLC tool,      |
|   not the runtime — and gives up trying to remember.              |
|                                                                    |
| After consolidation:                                               |
|   Devon knows: even if the deprecated `NWAVE_HARNESS_KNOBS=true`   |
|   is set in staging, the ENVIRONMENT=staging gate vetoes every    |
|   knob. The safety is structural — Devon's vigilance is not the   |
|   only line of defense. The env var name itself is being phased   |
|   out (US-CONSOL-4) in favor of a name that describes the         |
|   mechanism (fault injection), not a developer tool (nwave-ai).   |
+-------------------------------------------------------------------+
```

**Feels**: Today, tense — "am I one config flip away from a DoS surface?". After, confident — the gate is structural.

**Friction (today)**: anxiety borne by every developer who ships a knob change.
**Friction (after)**: anxiety relocated to the operator's `ENVIRONMENT` config, which is a single source of truth Olivia manages.

**Design lever**: US-CONSOL-2 (environment gate) + US-CONSOL-4 (`NWAVE_HARNESS_KNOBS` deprecation).

---

### Step 6: Reviewer reads the MR

```
+-- Step 6: Review --------------------------------------------------+
| Today:                                                              |
|   Reviewer: "should this be a knob or a contract test?"             |
|   Devon: "uhhh"                                                     |
|   (no shared vocabulary, conversation stalls)                       |
|                                                                      |
| After consolidation:                                                 |
|   Reviewer reads manifest entry:                                    |
|     rationale: "US-209: requires deterministic 5xx mid-flow         |
|       to validate atomicity of project-switch under partial        |
|       failure"                                                       |
|     contract_test_alternative_considered: true                      |
|                                                                      |
|   Reviewer: "Why was contract test rejected?"                       |
|   Devon: "We don't have a fake for the session-create port yet,    |
|     and building one is a 2-week effort. Logging this as           |
|     follow-up tech debt."                                            |
|   Reviewer: "Approve."                                              |
+--------------------------------------------------------------------+
```

**Feels**: Today, defensive. After, constructive — the rationale field is the shared vocabulary.

**Friction (today)**: high-effort review conversation with no scaffolding.
**Friction (after)**: manifest entry is the scaffolding.

**Design lever**: US-CONSOL-5 (rationale field).

---

## Emotional Arc Summary

```
EMOTIONAL VALENCE
                                                              + Confidence
                                                            *
                                                         *
                                                      *
                                                   *
                                                *
                                             *
                                          *
                                       *
                                    *
                                 *
                              *
                           *
                        *
                     *
                  *
               *
            *
         *                                                     - Frustration
+----+----+----+----+----+----+----+----+----+----+
   Step 1  Step 2  Step 3  Step 4  Step 5  Step 6
   Find    Decide  Wire    Validate Submit Review

Today's arc:   ----\____/----\____/----\____/    (volatile)
After:         _________________________________/  (monotonically up)
```

Today, Devon's emotional state is volatile: frustration during discovery, relief during wiring, anxiety during submission, defensiveness during review. After consolidation, the arc is monotonically upward — each step adds confidence rather than re-introducing friction.

---

## Adjacent journey: Olivia deploys to staging

Olivia is a secondary persona on this journey. Her journey is much shorter:

```
+-- Olivia's journey -----------------------------------------------+
| Today:                                                             |
|   1. Set NWAVE_HARNESS_KNOBS=false in staging compose overlay.    |
|   2. Hope no one accidentally sets it to true.                    |
|   3. Audit periodically.                                          |
|   4. Wonder why a runtime safety flag has 'NWAVE_' in its name    |
|      when nwave-ai is just a developer tool.                      |
|                                                                    |
| After consolidation:                                               |
|   1. Set ENVIRONMENT=staging in staging compose overlay.          |
|   2. Done. NWAVE_HARNESS_KNOBS value is irrelevant in staging     |
|      (and the env var is on its way out — see US-CONSOL-4).       |
|                                                                    |
|   On container start, Olivia sees:                                |
|     fault-injection.gate.disabled environment=staging             |
|     reason=environment_tier_denies                                |
|     inspection_probes_registered=false                            |
|                                                                    |
|   The structured log gives her affirmative evidence the gate is   |
|   closed, not the absence of evidence she has today.              |
+-------------------------------------------------------------------+
```

**Feels**: Today, vigilant. After, settled.

**Design lever**: US-CONSOL-2 (startup gate-verdict log).

---

## Friction Map

Cataloging every friction point Devon hits today, with the story that resolves it.

| Friction (today) | Resolved by |
|---|---|
| Three conventions to grep for knob discovery | US-CONSOL-1 |
| The word "harness" means six different things | US-CONSOL-1 + US-CONSOL-4 (vocabulary cleanup) |
| Read machine code to confirm knob semantics | US-CONSOL-1 (manifest target + rationale) |
| No checklist for "should this be a knob?" | US-CONSOL-5 |
| No audit trail of which knobs fired | US-CONSOL-3 |
| Single env-var is the only DoS safety net | US-CONSOL-2 |
| `NWAVE_` prefix on a runtime gate (looks like SDLC config) | US-CONSOL-4 (deprecate, replace) |
| Reviewer/author lack shared vocabulary | US-CONSOL-5 (rationale field) |
| Migrating callsites breaks acceptance scenarios | US-CONSOL-4 (adapter phase + atomic commits) |

Nine distinct frictions. Five stories. Each story resolves 1-2 frictions; no friction is unaddressed; no story is friction-free.

---

## Shared Artifacts (for `shared-artifacts-registry.md` — not produced this DISCUSS pass)

Variables that appear in the journey but should have a single source of truth in DESIGN-wave outputs:

- **Knob canonical name** — source: manifest entry. Consumers: production-side gate, audit log entries, manifest, reviewer-visible diff, pytest fixture string.
- **ENVIRONMENT tier value** — source: compose overlay env var (Olivia's domain). Consumers: fault-injection registry gate, startup log, inspection-probe registration condition.
- **Defense-in-depth flag name** (if DESIGN picks Q1.b) — recommended `FAULT_INJECTION_ENABLED`; DESIGN decides. Consumers: registry gate, startup log, deprecation message for `NWAVE_HARNESS_KNOBS`.
- **Manifest file path** — source: DESIGN ADR. Consumers: production code import, CI lint check, this journey doc.
- **Audit log event names** (`fault-injection.fired` / `.rejected` / `.unknown`) — source: registry module constant. Consumers: production-side emit calls, log-query examples in this journey doc, future operator dashboards.
- **Gate startup log event** (`fault-injection.gate.enabled` / `.disabled`) — source: registry module constant. Consumers: Olivia's container logs; production-mode startup verification.

Registry generation is deferred until DESIGN — at this stage the names exist as variables in `${italics}` placeholders, but the canonical home for each is undecided.

---

## Category boundary: fault injection vs inspection probes

This DISCUSS retires "harness" as a generic descriptor. Two categories of test-mode behavior remain, and the consolidation gates both via the same ENVIRONMENT mechanism — but the categories themselves are distinct.

| Category | Purpose | Members |
|---|---|---|
| **Fault injection** | Force deterministic failures at port boundaries (write-side / state-changing) | The 6 knobs: headers, events, body field |
| **Inspection probes** | Observe internal state for test assertions (read-only) | The 3 `/debug/*` endpoints on the agent service |

The fault-injection registry owns the gate, the manifest, the audit log. The inspection probes share the same ENVIRONMENT gate but are otherwise a separate concern — they don't appear in the manifest, they don't emit `fault-injection.*` audit entries. DESIGN may choose to co-locate them in `shared/fault-injection/` for gate-sharing reasons or to keep them in `agent/lib/inspection/` for category-clarity reasons; the open question is in `open-questions.md` Q2.

This matters for Devon: when he asks "is there a knob for X?", the answer might be "no, but there's an inspection probe for X" — and those are different shapes of solution. The vocabulary makes that distinction explicit.
