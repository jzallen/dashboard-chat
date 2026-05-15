// Plugin self-test: lint each probe file under `ui-state/lib/lint-probes/`
// and assert the expected violations are reported. This is the empirical
// half of Earned Trust principle 12 (ADR-039 §"Decision drivers"): the
// rule's coverage is proven by running it against a synthetic violation,
// not assumed from inspection of the rule source.
//
// Runs as part of `cd ui-state && vitest run` via the existing
// vitest.config.ts include pattern `lib/**/*.test.ts`.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import plugin from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBES_DIR = resolve(__dirname, "../../lint-probes");

interface LintOptions {
  ruleId: string;
  severity?: "warn" | "error";
  ruleOptions?: unknown[];
}

function lintProbe(probeFilename: string, opts: LintOptions) {
  const filePath = resolve(PROBES_DIR, probeFilename);
  const source = readFileSync(filePath, "utf8");
  const linter = new Linter({ configType: "flat" });
  const ruleConfig =
    opts.ruleOptions && opts.ruleOptions.length > 0
      ? [opts.severity ?? "error", ...opts.ruleOptions]
      : opts.severity ?? "error";
  const config = [
    {
      files: ["**/*.ts"],
      languageOptions: {
        // typescript-eslint v8 re-exports the underlying parser at
        // `tseslint.parser`. Using it (rather than the default espree)
        // gives us TSPropertySignature nodes for the C7/C12 rules.
        parser: tseslint.parser as unknown as Linter.ParserModule,
      },
      plugins: {
        "ui-state-conventions": plugin as unknown as Linter.Plugin,
      },
      rules: {
        [`ui-state-conventions/${opts.ruleId}`]:
          ruleConfig as Linter.RuleEntry,
      },
    },
  ];
  return linter.verify(source, config as Linter.Config[], filePath);
}

describe("eslint-plugin-ui-state-conventions (ADR-039)", () => {
  describe("C4 — no-failure-sim-event-prefix-outside-allowlist", () => {
    const RULE = "no-failure-sim-event-prefix-outside-allowlist";

    it("flags the probe's __user_signed_in__ literal", () => {
      const messages = lintProbe("c4-failure-sim-prefix.probe.ts", {
        ruleId: RULE,
      });
      // The violation name appears quoted ('name') in the message body; the
      // allowed-names enumeration uses bare names, so quoting disambiguates.
      const violations = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          m.message.includes("'__user_signed_in__'"),
      );
      expect(violations.length).toBe(1);
    });

    it("does NOT flag allowlisted failure-sim names or domain events", () => {
      const messages = lintProbe("c4-failure-sim-prefix.probe.ts", {
        ruleId: RULE,
      });
      const falsePositives = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          (m.message.includes("'__force_failure__'") ||
            m.message.includes("'__expire_token__'") ||
            m.message.includes("'sign_in_clicked'")),
      );
      expect(falsePositives).toEqual([]);
    });
  });

  describe("C7 — intent-prefix-deeplink-only", () => {
    const RULE = "intent-prefix-deeplink-only";

    it("flags the probe's intent_session_id type and value declarations", () => {
      const messages = lintProbe("c7-intent-prefix.probe.ts", {
        ruleId: RULE,
      });
      const violations = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          m.message.includes("'intent_session_id'"),
      );
      // Two declarations of `intent_session_id` in the probe:
      //   1. TSPropertySignature in FakeContextProbeViolation
      //   2. Property in fakeContextValueProbe object literal
      expect(violations.length).toBe(2);
    });

    it("does NOT flag allowlisted intent_project_id or unrelated names", () => {
      const messages = lintProbe("c7-intent-prefix.probe.ts", {
        ruleId: RULE,
      });
      const falsePositives = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          (m.message.includes("'intent_project_id'") ||
            m.message.includes("'pending_project_name'")),
      );
      expect(falsePositives).toEqual([]);
    });
  });

  describe("C12 — no-machine-name-prefix-on-projection-fields", () => {
    const RULE = "no-machine-name-prefix-on-projection-fields";

    it("flags the probe's session_chat_pending_message declarations", () => {
      const messages = lintProbe("c12-machine-name-prefix.probe.ts", {
        ruleId: RULE,
      });
      const violations = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          m.message.includes("'session_chat_pending_message'"),
      );
      // Two declarations: TSPropertySignature in
      // FakeProjectionProbeViolation + Property in fakeProjectionValueProbe.
      expect(violations.length).toBe(2);
    });

    it("flags the project_context_org_id declaration (different banned prefix)", () => {
      const messages = lintProbe("c12-machine-name-prefix.probe.ts", {
        ruleId: RULE,
      });
      const violations = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          m.message.includes("'project_context_org_id'"),
      );
      expect(violations.length).toBe(1);
    });

    it("does NOT flag data-shaped names or substring matches", () => {
      const messages = lintProbe("c12-machine-name-prefix.probe.ts", {
        ruleId: RULE,
      });
      const falsePositives = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          (m.message.includes("'pending_message'") ||
            m.message.includes("'project_id'") ||
            m.message.includes("'chat_session_id'")),
      );
      expect(falsePositives).toEqual([]);
    });

    it("does NOT flag reducer dispatch-table entries (function values)", () => {
      // The probe declares `fakeProjectionReducerTable` with two
      // function-valued properties whose keys would otherwise match
      // banned prefixes (`project_context_resolution_started`,
      // `session_chat_recoverable_error`). The rule should skip them
      // because the value is a function — these are dispatch tags, not
      // data fields. See rule source for the scope-exclusion rationale.
      const messages = lintProbe("c12-machine-name-prefix.probe.ts", {
        ruleId: RULE,
      });
      const falsePositives = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          (m.message.includes("'project_context_resolution_started'") ||
            m.message.includes("'session_chat_recoverable_error'")),
      );
      expect(falsePositives).toEqual([]);
    });
  });

  describe("LEAF-D — no-orchestrator-snapshot-reads", () => {
    const RULE = "no-orchestrator-snapshot-reads";
    const PROBE = "leaf-d-no-orchestrator-snapshot-reads.probe.ts";

    it("flags snapshot.context member reads", () => {
      const messages = lintProbe(PROBE, { ruleId: RULE });
      const violations = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          m.messageId === "snapshotMemberRead",
      );
      // Three expected member-access violations:
      //   readSnapshotMember         (snapshot.context.project_id)
      //   readSnapshotBracket        (snapshot["context"].project_id)
      //   readSnapshotDestructure    (const { project_id } = snapshot.context)
      expect(violations.length).toBe(3);
    });

    it("flags snapshot.getContext() method calls", () => {
      const messages = lintProbe(PROBE, { ruleId: RULE });
      const violations = messages.filter(
        (m) =>
          m.ruleId === `ui-state-conventions/${RULE}` &&
          m.messageId === "snapshotMethodRead",
      );
      // One method-call violation: readSnapshotMethod.
      expect(violations.length).toBe(1);
    });

    it("does NOT flag projection.context, ctx alias, or event.output", () => {
      const messages = lintProbe(PROBE, { ruleId: RULE });
      const ruleHits = messages.filter(
        (m) => m.ruleId === `ui-state-conventions/${RULE}`,
      );
      // 3 member + 1 method = 4 total. Anything beyond that is a false
      // positive on the passing fixtures (projection.context, ctx alias,
      // event.output).
      expect(ruleHits.length).toBe(4);
    });
  });
});
