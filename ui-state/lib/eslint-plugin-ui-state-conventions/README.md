# eslint-plugin-ui-state-conventions

Custom ESLint rules that mechanically enforce the lint-tier (E1) conventions from [ADR-039](../../../docs/decisions/adr-039-ui-state-naming-conventions.md). Wired into the root [`eslint.config.js`](../../../eslint.config.js) and applied to `ui-state/**/*.ts`. Initial severity is `warn` for all three rules; pre-existing violations are present in `projection.ts` and will be cleaned up by the audit's MR-D and MR-H rename passes ([audit §8](../../../docs/discussion/ui-state-vocabulary-audit/findings.md)).

Each rule is paired with a probe under [`../lint-probes/`](../lint-probes/). The probe is a static fixture (never executed) that contains a deliberate violation; the plugin's test suite (`__tests__/rules.test.ts`) asserts the rule fires on the probe. This is the empirical half of Earned Trust principle 12 from ADR-039 §"Decision drivers": the rule's coverage is proven by running it against a synthetic violation, not assumed from inspection of the rule source.

## Rules

### `no-failure-sim-event-prefix-outside-allowlist` (ADR-039 C4)

Reserves the `__double_underscore__` event-name shape for failure-simulation side channels. Production code that emits a `__token__` event must either be one of the ratified failure-simulation knobs ([ADR-038](../../../docs/decisions/adr-038-failure-simulation-naming-phase-plan.md)) or be removed as a vocabulary leak. Default allowlist: `__force_failure__`, `__expire_token__`. Probe: [`c4-failure-sim-prefix.probe.ts`](../lint-probes/c4-failure-sim-prefix.probe.ts).

### `intent-prefix-deeplink-only` (ADR-039 C7)

Reserves the `intent_` prefix on context-field declarations for URL-level user wishes only. The vocabulary audit identified three meanings carried by `intent_` today ([§5 Tier-1 #2](../../../docs/discussion/ui-state-vocabulary-audit/findings.md)); MR-D will split them so click-captured resume targets move to `pending_resume_*` and user-action commands become `_clicked` events, leaving `intent_` with one meaning. Default allowlist: `intent_project_id`. Probe: [`c7-intent-prefix.probe.ts`](../lint-probes/c7-intent-prefix.probe.ts).

### `no-machine-name-prefix-on-projection-fields` (ADR-039 C12)

Forbids machine-name prefixes (`session_chat_`, `project_context_`, `login_`) on projection field names. Field names describe the data, not the producer; the prefix encodes the producer machine's identity into the read shape that downstream consumers must depend on ([audit Tier-1 #5](../../../docs/discussion/ui-state-vocabulary-audit/findings.md)). MR-H collapses the existing violations (`session_chat_project_id`, `session_chat_project_name`) gated on the field-collapse property test from audit §9 Q3. Probe: [`c12-machine-name-prefix.probe.ts`](../lint-probes/c12-machine-name-prefix.probe.ts).

## Severity migration

- **C4** — `warn` initially. No current production violations; upgrade to `error` is safe at any time.
- **C7** — `warn` initially; flips to `error` after MR-D lands ([audit §8](../../../docs/discussion/ui-state-vocabulary-audit/findings.md)) so the merge queue gates new violations rather than letting them coexist with the legacy ones during the rename window.
- **C12** — `warn` initially; flips to `error` after MR-H lands ([audit §8](../../../docs/discussion/ui-state-vocabulary-audit/findings.md)) for the same reason.

## Layout

```
eslint-plugin-ui-state-conventions/
├── README.md
├── index.js                 # plugin export — rules registry
├── rules/
│   ├── no-failure-sim-event-prefix-outside-allowlist.js
│   ├── intent-prefix-deeplink-only.js
│   └── no-machine-name-prefix-on-projection-fields.js
└── __tests__/
    └── rules.test.ts        # vitest: probes flag, allowlist passes
```
