// Rule: intent-prefix-deeplink-only (ADR-039 C7)
//
// The `intent_` prefix on context fields marks ONLY URL-level user wishes
// not yet confirmed or denied by the system. The vocabulary audit
// identified three meanings carried by `intent_` today (deep-link, click-
// captured resume, transition intent); MR-D will split them so the prefix
// retains one meaning post-rename. This rule flags any context-field
// declaration whose name is `intent_*` and not in the allowlist.
//
// Allowlist: canonical URL-level deep-link intents only. The audit's
// resolution (ADR-039 §Q4) gives the example `intent_project_id`.
//
// Initial severity is `warn` because pre-MR-D violations still exist
// (`intent_session_id`, `intent_resource_id`, `intent_resource_type`).
// MR-D upgrades to `error` once those are renamed to `pending_resume_*`
// or carried only as event payload (not stored on context).

const DEFAULT_ALLOWLIST = ["intent_project_id"];
const INTENT_PATTERN = /^intent_/;

function extractKeyName(key) {
  if (!key) return null;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Reserve the intent_ prefix for URL-level deep-link wishes only (ADR-039 C7).",
      url: "docs/decisions/adr-039-ui-state-naming-conventions.md#c7--intent_-prefix-marks-url-level-user-wishes-only",
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
        "Field name '{{name}}' uses the intent_ prefix, which is reserved for URL-level " +
        "deeplink-origin wishes (ADR-039 C7). Allowed names: {{allowlist}}. Click-captured " +
        "resume targets use the pending_resume_ prefix; user-action commands become _clicked " +
        "events.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const allowlist = new Set([
      ...DEFAULT_ALLOWLIST,
      ...(options.allowlist ?? []),
    ]);

    function check(key, node) {
      const name = extractKeyName(key);
      if (name === null) return;
      if (!INTENT_PATTERN.test(name)) return;
      if (allowlist.has(name)) return;
      context.report({
        node,
        messageId: "reservedPrefix",
        data: {
          name,
          allowlist: [...allowlist].sort().join(", "),
        },
      });
    }

    return {
      TSPropertySignature(node) {
        check(node.key, node);
      },
      // ObjectExpression initializers (e.g. initialContext()) carry the
      // same fields at the value level. Flag those too so the type-level
      // and value-level declarations stay aligned.
      Property(node) {
        check(node.key, node);
      },
    };
  },
};

export default rule;
