// Rule: no-orchestrator-snapshot-reads (ADR-030 §"Migration sequencing" LEAF-D)
//
// FlowEvent-emission paths in the orchestrator MUST read from the projection
// (which is rebuilt deterministically from the FlowEvent log) — never from
// the machine snapshot's context. The projection is the single source of
// truth for read state per ADR-030 §"Decision outcome"; the machine snapshot
// is internal handler state per ADR-028 §"Amendment 2026-05-15".
//
// LEAF-A (5826660) and LEAF-B (5f4e635) cleared every pre-existing snapshot
// read from orchestrator.ts. This rule activates on a clean tree and
// prevents regression. Severity is `error` from day one.
//
// Patterns flagged:
//   1. `snapshot.context`     — member access (any depth: snapshot.context.x)
//   2. `snapshot.context.x`   — covered by (1) — the .context access fires
//   3. `snapshot["context"]`  — bracket-notation form of (1)
//   4. `snapshot.getContext()` — the XState v5 actor accessor method
//
// NOT flagged:
//   - `projection.context.x`  — the legal read source
//   - `event.output.x`        — the Direction F hand-off channel (ADR-028)
//   - `ctx.x` where ctx was bound from projection.context (the rule keys on
//     the `snapshot` identifier specifically; binding a local alias from
//     the projection is fine)

function isSnapshotIdentifier(node) {
  return node && node.type === "Identifier" && node.name === "snapshot";
}

function isContextProperty(property, computed) {
  if (!property) return false;
  if (!computed && property.type === "Identifier" && property.name === "context") {
    return true;
  }
  if (computed && property.type === "Literal" && property.value === "context") {
    return true;
  }
  return false;
}

function isGetContextProperty(property) {
  return (
    property &&
    property.type === "Identifier" &&
    property.name === "getContext"
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid reads from snapshot.context / snapshot.getContext() in " +
        "FlowEvent-emission paths (ADR-030 §LEAF-D).",
      url: "docs/decisions/adr-030-flow-state-topology-and-scaling.md#migration-sequencing",
    },
    schema: [],
    messages: {
      snapshotMemberRead:
        "Read from snapshot.context is forbidden in this path (ADR-030 §LEAF-D). " +
        "The projection is the single source of truth for read state — use " +
        "buildProjection(...).context instead. If the field you need is not " +
        "yet on the projection, extend the projection reducer rather than " +
        "falling back to snapshot.",
      snapshotMethodRead:
        "Call to snapshot.getContext() is forbidden in this path (ADR-030 §LEAF-D). " +
        "The projection is the single source of truth for read state — use " +
        "buildProjection(...).context instead.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isSnapshotIdentifier(node.object)) return;
        if (isContextProperty(node.property, node.computed)) {
          context.report({ node, messageId: "snapshotMemberRead" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression") return;
        if (!isSnapshotIdentifier(callee.object)) return;
        if (isGetContextProperty(callee.property)) {
          context.report({ node, messageId: "snapshotMethodRead" });
        }
      },
    };
  },
};

export default rule;
