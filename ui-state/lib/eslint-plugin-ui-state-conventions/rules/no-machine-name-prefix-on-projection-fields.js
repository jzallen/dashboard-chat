// Rule: no-machine-name-prefix-on-projection-fields (ADR-039 C12)
//
// Projection field names describe the DATA, not the PRODUCER. A field
// named `session_chat_project_id` leaks the producer machine's identity
// into the read shape that downstream consumers (FE, acceptance harness)
// must depend on. Per ADR-039 §C12 those consumers care what the field
// represents, not which machine wrote it.
//
// The audit identified two original violations (session_chat_project_id /
// session_chat_project_name); both were collapsed in MR-H + the §9 Q3
// follow-up (commit 00c5891) into the shared `project: { id, name }`
// field. The collapse-gating property test lives at
// `projection-property.test.ts`.
//
// SCOPE EXCLUSION — reducer dispatch entries. In the projection reducer
// (`projection.ts`), event-name → handler-function mappings are encoded
// as object-literal properties:
//
//   const REDUCERS = {
//     project_context_resolution_started: (state, ctx, event) => { ... },
//     project_context_recoverable_error:  (state, ctx, event) => { ... },
//   };
//
// These property KEYS carry the wire-event name — the audit's recommended
// canonical vocabulary per MR-F / MR-H, where `project_context_*` is the
// source-tree-aligned event-name convention. The key here is a DISPATCH
// TAG, not a data-field declaration; renaming it would break the
// dispatcher. The rule detects these by skipping `Property` nodes whose
// value is a function expression.
//
// Type-level `TSPropertySignature` nodes (interface members declaring the
// projection's read shape, e.g. `ReducedContext`) are still checked —
// those are the rule's original target.

const DEFAULT_BANNED_PREFIXES = ["session_chat", "project_context", "login"];

function extractKeyName(key) {
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makePattern(prefixes) {
  // Match `<prefix>_` where <prefix> is one of the configured machine names.
  // Field names that merely contain the prefix as a substring (e.g.
  // `chat_session_id`) are NOT flagged — only field names that BEGIN
  // with a machine name are leaks.
  const alternation = prefixes.map(escapeRegex).join("|");
  return new RegExp(`^(?:${alternation})_`);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid machine-name prefixes on projection field names (ADR-039 C12).",
      url: "docs/decisions/adr-039-ui-state-naming-conventions.md#c12--machine-name-leakage-into-projection-fields-is-a-smell",
    },
    schema: [
      {
        type: "object",
        properties: {
          prefixes: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
          allowlist: {
            type: "array",
            items: { type: "string" },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      machineNamePrefix:
        "Field name '{{name}}' begins with the machine name '{{prefix}}_'. " +
        "Projection fields describe data, not producer (ADR-039 C12). Rename to a " +
        "data-only name (e.g. project_id instead of {{prefix}}_project_id).",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const prefixes = options.prefixes ?? DEFAULT_BANNED_PREFIXES;
    const pattern = makePattern(prefixes);
    const allowlist = new Set(options.allowlist ?? []);

    function check(key, node) {
      const name = extractKeyName(key);
      if (name === null) return;
      if (!pattern.test(name)) return;
      if (allowlist.has(name)) return;
      const prefix = prefixes.find((p) => name.startsWith(`${p}_`)) ?? "";
      context.report({
        node,
        messageId: "machineNamePrefix",
        data: { name, prefix },
      });
    }

    function isFunctionValue(node) {
      if (!node || !node.value) return false;
      const valueType = node.value.type;
      return (
        valueType === "ArrowFunctionExpression" ||
        valueType === "FunctionExpression"
      );
    }

    return {
      TSPropertySignature(node) {
        // Type-level field declarations — always check. Interface members
        // are how projection read-shapes (e.g. ReducedContext) are declared.
        check(node.key, node);
      },
      Property(node) {
        // Reducer dispatch-table entries (event-name → handler-function)
        // are intentionally named after the wire event. Skip them so the
        // rule fires only on data-field declarations.
        if (isFunctionValue(node)) return;
        check(node.key, node);
      },
    };
  },
};

export default rule;
