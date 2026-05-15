# Mikado: split `intent_session_id` into two fields

**Goal (root):** After MR-D, `ui-state` has zero context-field usage of `intent_session_id`. The single misleading field becomes two: `deeplink_session_id` (URL-level wish, on project-context + projection) and `pending_resume_session_id` (click-captured target, on session-chat + projection). `intent_project_id` follows for symmetry → `deeplink_project_id`. `intent_resource_id` and `intent_resource_type` are removed from `ProjectContextMachineContext` (per Direction F / ADR-030 — pure pass-through; the orchestrator forwards them from the `open_deep_link` event payload directly into the `project_ready` broadcast without ever touching project-context's context).

**Wire-protocol affected.** Projection field names rename in sync; FE + acceptance harness read those names.

**Audit reference.** `docs/discussion/ui-state-vocabulary-audit/findings.md` §5 "intent — THREE meanings" + §7 Tier-1 #2 + §8 MR-D row.

---

## Dependency tree

The tree is leaf-to-goal; each leaf can land as one atomic commit. Two-commit plan: (1) renames; (2) `intent_resource_*` removal.

```
GOAL — vitest green at baseline (95/95 minus 2 pre-existing failures);
       eslint clean; acceptance suites green; FE reads new field names.
│
├── LEAF-1: ui-state/lib/machines/project-context/{machine.ts,machine.test.ts}
│           Rename `intent_project_id` → `deeplink_project_id`
│           Rename `intent_session_id` → `deeplink_session_id`
│           Remove `intent_resource_id` + `intent_resource_type` from
│           ProjectContextMachineContext (still in `open_deep_link` event
│           payload, but never assigned to context — the orchestrator
│           forwards them from the event payload directly).
│
├── LEAF-2: ui-state/lib/machines/session-chat/{machine.ts,machine.test.ts}
│           Rename `intent_session_id` → `pending_resume_session_id` (ctx).
│           Rename `project_ready` event payload key
│             `intent_session_id` → `deeplink_session_id` (the inbound
│             URL-level value that becomes the click-captured target on
│             capture-equivalent paths? No — at the inbound boundary the
│             value IS the URL wish from project-context; it lands in
│             pending_resume_session_id directly because session-chat
│             treats the wish as a pending click-equivalent. This matches
│             the existing capturePendingResumeIntent action's responsibility).
│           Inbound `intent_resource_id` / `intent_resource_type` payload
│             keys on `project_ready` no longer touch session-chat ctx
│             (they were already not stored — see machine.ts:97-105).
│           `capturePendingResumeIntent` action keeps its name (already
│             correctly named — the field is what was misleading).
│
├── LEAF-3: ui-state/lib/orchestrator.ts
│           Update `project_ready` broadcast payload field names to
│             `deeplink_session_id`. The `intent_resource_*` pass-through
│             now reads from the `open_deep_link` event payload directly
│             (or the projection's deep-link record), not from
│             project-context context. Update logged FlowEvent payloads
│             (`deep_link_opened`, `scope_mismatch_displayed`,
│             `switching_project_started`) to emit `deeplink_*` keys.
│           Update internal ProjectionCtx type aliases to match.
│
├── LEAF-4: ui-state/lib/projection.ts
│           Rename `intent_project_id` → `deeplink_project_id`.
│           Rename `intent_session_id` → `deeplink_session_id` (the
│             URL-level half — populated by `deep_link_opened` /
│             `scope_mismatch_displayed` event consumers).
│           ADD `pending_resume_session_id` field — populated by
│             `session_clicked` capture and cleared by
│             `session_resumed` / `session_resume_not_found` /
│             `switching_project_started`.
│           `intent_resource_id` + `intent_resource_type` stay on the
│             projection but are now fed exclusively from event payloads
│             (deep-link/scope-mismatch handlers), never from
│             project-context ctx.
│
├── LEAF-5: frontend/app/lib/ui-state-client.ts
│           frontend/app/routes/chat.tsx
│           frontend/app/routes/project-detail.tsx
│           Read renamed projection fields.
│
├── LEAF-6: tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts
│           tests/acceptance/project-and-chat-session-management/{driver.py,
│             test_us204_*,test_us205_*,test_us207_*}
│           Update field names in type definitions + Python assertions.
│
└── LEAF-7: ui-state/lib/machines/project-context/README.md
          ui-state/lib/machines/session-chat/README.md
          ui-state/index.ts
          eslint.config.js (only the comment block referring to MR-D)
          DO NOT modify: ui-state/lib/eslint-plugin-ui-state-conventions/**
            and ui-state/lib/lint-probes/c7-intent-prefix.probe.ts
            — the rule's allowlist still contains `intent_project_id`
            because the `open_deep_link` event PAYLOAD keys remain
            `intent_*` (deferred follow-up). Severity stays at `warn`;
            the residual warnings will be confined to the event-payload
            occurrences after this MR.
```

---

## Execution order

LEAF-1 → LEAF-2 → LEAF-3 → LEAF-4 land as one commit (the renames). LEAF-1 alone deletes two fields (`intent_resource_id`, `intent_resource_type`) from project-context's context — this is the *deletion* half. The tree groups it with the renames because all four migrations are referentially coupled (test setup constructs context with all four; deleting two while renaming two is the same edit cluster).

LEAF-5 + LEAF-6 + LEAF-7 follow. They're separable in principle but the projection rename in LEAF-4 is wire-protocol-breaking, so the FE + acceptance must land in the same MR. Single commit covers all renames + removals; recommended commit split:

1. **Commit 1** — Renames: LEAF-1 + LEAF-2 + LEAF-3 + LEAF-4 + LEAF-5 + LEAF-6 + LEAF-7 (`intent_session_id` → `deeplink_session_id` + `pending_resume_session_id`; `intent_project_id` → `deeplink_project_id`).
2. **Commit 2** — Removal: the `intent_resource_id` + `intent_resource_type` deletion from `ProjectContextMachineContext` (split out for higher review focus on the deletion).

If Commit 2 cannot be split out cleanly (the deletion touches the same lines as the renames in machine.ts), keep it as one commit and call out the deletion in the message body.

## Discovery commits (this MR)

None expected — the tree is clean from the audit. If a hidden reader emerges (e.g. an analytics path that reads `intent_session_id` off the projection through a back door), append a leaf and a discovery commit.
