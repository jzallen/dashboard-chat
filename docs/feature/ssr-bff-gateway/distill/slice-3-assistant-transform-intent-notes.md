# Slice 3 — Assistant transform intent (DISTILL notes)

Part of the **ssr-bff-gateway** feature. Slices 1 (live `/bff/chat` relay) and 2
(auth-proxy Bearer rehydration on the `/worker` hop) are on `main`. This slice
closes the last gap: a live assistant turn against an open dataset now actually
*applies a transform* instead of returning a generic chat answer, and the
AssistantOverlay shows its dataset context (or its absence) at a glance.

## Bug (root cause — VERIFIED)

A live turn — open dataset → AssistantOverlay → "lowercase email" — returned a
GENERIC chat answer, no transform.

The `ui/` chat POST (`Chat.tsx:runScript`) omits `tableSchema`, and the agent
gated the transform-capable system prompt on it:
`agent/lib/chat/handleChat.ts:151` — `else if (contextType === "dataset" &&
tableSchema?.columns)` selected the dataset prompt+tools; ELSE fell through to the
CONVERSATIONAL prompt (`prompts.ts:543`) which literally tells the model "you
cannot perform table operations". The cleaning tools were in the merged toolset
(via `dispatcherRegistry`, which keys only on `datasetId`), but the prompt steered
the model away from them. **Prompt selection, not tool registration, was the bug.**

## Fix

**Part A — agent self-sufficiency (durable fix).** When a `datasetId` is in scope
and the caller did not send a `tableSchema`, the agent FETCHES the columns from the
backend (`GET /api/datasets/{id}?include_transforms=true`) and uses the
transform-capable dataset prompt+tools. The caller-supplied-`tableSchema` fast path
is preserved unchanged (no GET). A failed fetch (404/401/network) GRACEFULLY
DEGRADES to the conversational prompt AND logs a warning — diagnosable, not a
silent repeat of this bug. Scope: `agent/lib/chat/` only; no backend, no
prompt/tool-signature changes.

**Part B — AssistantOverlay context indicator (`ui/`).** The chip now reads
dot + name + **layer word**; when there is no context it renders an explicit
"No dataset in context" chip instead of collapsing — a missing-context turn is
visible at a glance.

## Acceptance criteria (port-to-port)

- **AC-1 (driving port: agent `handleChat`)** — When a turn arrives with
  `contextType="dataset"` + a resolvable `datasetId` + NO `tableSchema`, and the
  backend dataset GET returns a `schema_config`, the DATASET system prompt is
  selected and the cleaning tools (`standardizeCase` / `applyCleaningTransform`)
  are in the final toolset — NOT the conversational prompt.
- **AC-2 (fast path)** — When the caller supplies a `tableSchema`, no backend GET
  is issued (behavior unchanged).
- **AC-3 (graceful degrade)** — When the dataset GET fails, the turn degrades to
  the conversational prompt and logs a warning; the turn does not crash.
- **AC-4 (mapper)** — `schema_config.fields` maps to `TableSchema.columns`
  (id = column name, type from the field spec); response `transforms` map to
  `activeCleaningTransforms`.
- **AC-5 (driving port: `AssistantOverlay`)** — The context chip renders
  dot + name + layer word when a context node is present, and a
  "No dataset in context" chip when context is null.

## Test strategy

This is a TS/vitest brownfield slice (not pytest-bdd), so the acceptance tests are
the colocated vitest specs, driven Outside-In:

| AC | Test (RED-first) |
|----|------------------|
| AC-1/2/3 | `agent/test/chat/datasetSchemaResolution.test.ts` (drives `handleChat`) |
| AC-4 | `agent/test/chat/datasetSchema.test.ts` (pure mapper + `fetchTableSchema`) |
| AC-5 | `ui/app/components/Chat/Chat.test.tsx` (renders `AssistantOverlay`) |

Live smoke (AC-1 end-to-end through a real model) is BEST-EFFORT: the model's
decision to call the tool is nondeterministic and needs `GROQ_API_KEY`. The unit
tests above are the reliable proof that prompt/tool SELECTION is fixed; live
browser confirmation is flagged for the human.

## Scope guardrails

`agent/` (Part A) + `ui/` (Part B) + this distill dir ONLY. No `backend/`, no
`frontend/`, no prompt/tool-signature changes, no change to the
caller-supplied-`tableSchema` fast path.
