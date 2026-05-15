// ESLint plugin: ui-state-conventions
//
// Custom rules that mechanically enforce the lint-tier (E1) conventions
// from ADR-039 §"Tier E1 — Lint-enforced". Each rule has a probe under
// ../lint-probes/ that contains a deliberate violation; the test suite at
// __tests__/rules.test.ts asserts the rule fires on its probe (Earned
// Trust principle 12: every lint rule must come with a probe that proves
// its coverage empirically).
//
// Wiring: imported by eslint.config.js at the repo root and applied to
// `ui-state/lib/**/*.ts`. Initial severity is `warn` for all three because
// existing violations are present in the codebase and will be removed by
// follow-up MRs (MR-D for intent_, MR-H for session_chat_/project_context_).
//
// References:
//   - docs/decisions/adr-039-ui-state-naming-conventions.md
//   - docs/discussion/ui-state-vocabulary-audit/findings.md

import noFailureSimEventPrefixOutsideAllowlist from "./rules/no-failure-sim-event-prefix-outside-allowlist.js";
import intentPrefixDeeplinkOnly from "./rules/intent-prefix-deeplink-only.js";
import noMachineNamePrefixOnProjectionFields from "./rules/no-machine-name-prefix-on-projection-fields.js";
import noOrchestratorSnapshotReads from "./rules/no-orchestrator-snapshot-reads.js";

const plugin = {
  meta: {
    name: "eslint-plugin-ui-state-conventions",
    version: "0.1.0",
  },
  rules: {
    "no-failure-sim-event-prefix-outside-allowlist":
      noFailureSimEventPrefixOutsideAllowlist,
    "intent-prefix-deeplink-only": intentPrefixDeeplinkOnly,
    "no-machine-name-prefix-on-projection-fields":
      noMachineNamePrefixOnProjectionFields,
    "no-orchestrator-snapshot-reads": noOrchestratorSnapshotReads,
  },
};

export default plugin;
