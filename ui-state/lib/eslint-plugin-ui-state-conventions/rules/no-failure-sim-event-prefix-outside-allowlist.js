// Rule: no-failure-sim-event-prefix-outside-allowlist (ADR-039 C4)
//
// Event names of the shape `__name__` (begins and ends with a double
// underscore) are reserved for failure-simulation side channels per
// ADR-038. The visual marker tells reviewers the event is a probe, not a
// domain event. Production code that emits `__name__` is either an
// allow-listed knob or a vocabulary leak that needs to be removed.
//
// The rule scans string literals and template strings; flags any
// `__token__` value that is not in the allowlist. Default allowlist is
// the two ratified failure-simulation knobs (ADR-038); additional names
// can be added via the rule's `allowlist` option for in-tree tooling that
// owns its own dev-only channels.

const DEFAULT_ALLOWLIST = ["__force_failure__", "__expire_token__"];
const FAILURE_SIM_PATTERN = /^__[a-z][a-z0-9_]*__$/;

function extractStringValue(node) {
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.quasis.length === 1) {
    // No interpolation: the literal is the whole event name.
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Reserve __double_underscore__ event names for failure-simulation side channels (ADR-039 C4).",
      url: "docs/decisions/adr-039-ui-state-naming-conventions.md#c4--double_underscore-prefix-marks-failure-simulation-side-channels",
    },
    schema: [
      {
        type: "object",
        properties: {
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
      reservedPrefix:
        "Event name '{{name}}' uses the __reserved__ failure-simulation prefix (ADR-039 C4). " +
        "Allowed names: {{allowlist}}. To add a new failure-simulation knob, update the rule's " +
        "allowlist option in eslint.config.js with rationale in the commit.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowlist = new Set([
      ...DEFAULT_ALLOWLIST,
      ...(options.allowlist ?? []),
    ]);

    function check(node) {
      const value = extractStringValue(node);
      if (value === null) return;
      if (!FAILURE_SIM_PATTERN.test(value)) return;
      if (allowlist.has(value)) return;
      context.report({
        node,
        messageId: "reservedPrefix",
        data: {
          name: value,
          allowlist: [...allowlist].sort().join(", "),
        },
      });
    }

    return {
      Literal(node) {
        check(node);
      },
      TemplateLiteral(node) {
        check(node);
      },
    };
  },
};

export default rule;
