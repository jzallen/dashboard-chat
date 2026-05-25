# `/event` route cleanup — DESIGN review (read-only)

**Wave:** DESIGN (brownfield delta, review-only) · **Date:** 2026-05-25 · **Author:** Hera (nw-ddd-architect)
**Subject:** Error-path structure + comment style of `router.post("/event", …)` in
`ui-state/lib/machines/session-onboarding/router.ts`.
**Scope guard:** recommendation only — no source edits proposed beyond this route's handler.
Honors ratified D-E1 / D-E2 / D-E3 (`event-slice-scope.md`), OQ-E3 (incremental), ADR-028, ADR-040,
ADR-041. Does NOT revisit D-E1.

## 1. Error-path classification

| Current path (handler order) | Classification | Where it belongs | Verdict |
|---|---|---|---|
| malformed JSON → 400 | transport well-formedness | ACL (try/catch) | keep as-is |
| `eventRequestSchema` parse fail → 400 `issues` | wire well-formedness (envelope) | ACL (zod) | keep; **extend** to absorb the two hand-rolled `if`s |
| `__force_failure__` gate disabled → 403 | failure-simulation **authorization** (ADR-035), not parsing | ACL (gate), but it is a *policy* check distinct from shape | keep as a separate gate step (it is neither zod nor domain) |
| `__force_failure__.tag` not a known `UnderlyingCauseTag` → 400 (hand-rolled `if`) | wire well-formedness **of a closed-set enum**, reusing the domain's vocabulary (D-E2) | ACL (zod `.refine`/`enum` backed by `isUnderlyingCauseTag`) | **move into the schema** |
| `org_form_submitted.payload.org_name` not a string → 400 (hand-rolled `if`) | wire well-formedness (is it a string *at all*) — D-E1 line | ACL (zod `z.string()`) | **move into the schema** |
| empty `org_name` (`""`) → 200 + validation error | genuine DOMAIN invariant | `constructOrgName` (already there) — NOT the ACL | **stays in domain, untouched** (D-E1) |

Key point: **both hand-rolled `if`s are ACL well-formedness, not domain invariants.** They check
"is this command structurally a command" (a known tag; a string name), which is exactly zod's job.
Neither expresses an aggregate invariant, so neither belongs in `domain.ts`. The single genuine
domain rule on this route (empty/short/long name) already lives on `constructOrgName` and must stay
there — promoting it would duplicate it and violate D-E1.

## 2. Where zod is right vs where it would leak a domain rule

- **Right at the ACL:** the envelope (`machine?`, `type`, `payload`) AND the two per-event payload
  shapes (`tag` ∈ closed set; `org_name` is a string). A **discriminated union on `type`** expresses
  this cleanly and deletes both hand-rolled `if`s. OQ-E3 said "incremental, not one union up front" —
  that was a *delivery-sequencing* decision for landing Slices 1/4/6 independently. Now that all three
  validations exist and are green, **consolidating them into one discriminated-union schema is the
  natural post-slice refactor** and is fully consistent with the ratified end-state (D-E1 keeps it at
  the ACL; D-E2 keeps `tag` backed by the domain predicate).
- **Would leak a domain rule (do NOT do):** putting the empty/min/max `org_name` rule into zod
  (`z.string().min(2).max(64)`). That rule is the value object's (`ORG_NAME_RULES`); duplicating its
  bounds in zod creates two sources of truth and breaks the deliberate D-E1 contrast (absent → 400 at
  ACL; empty → 200 + domain validation error). zod validates **string-ness**; `constructOrgName`
  validates **name-ness**. Keep that seam.

## 3. Recommended handler shape (read top-to-bottom: parse → gate → translate → forward)

The discriminated union carries the per-type payload shapes; `tag` is validated against the domain's
own predicate so the boundary and the failure vocabulary never drift (D-E2). The gate (ADR-035) is a
distinct authorization step, kept explicit. After parse + gate, the body is a straight
`translate → send → serialize` with no inline `if`s.

```ts
// tag is validated against the DOMAIN's closed set (D-E2) — one source of truth.
const causeTag = z.string().refine(isUnderlyingCauseTag, {
  message: "tag must be a known UnderlyingCauseTag",
});

const eventRequestSchema = z.discriminatedUnion("type", [
  z.object({ machine: z.string().optional(), type: z.literal("org_form_submitted"),
             payload: z.object({ org_name: z.string() }).passthrough() }),
  z.object({ machine: z.string().optional(), type: z.literal("retry_clicked"),
             payload: z.record(z.unknown()).optional() }),
  z.object({ machine: z.string().optional(), type: z.literal("__force_failure__"),
             payload: z.object({ tag: causeTag }).passthrough() }),
]);
```

```ts
router.post("/event", async (c) => {
  const requestId = c.req.header("X-Request-Id") ?? cryptoRandomId();

  let rawBody: unknown;
  try { rawBody = await c.req.json(); }
  catch { return c.json({ error: "invalid_request" }, 400); }

  const parsed = eventRequestSchema.safeParse(rawBody);
  if (!parsed.success)
    return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
  const event = parsed.data;

  const flowId = `${SESSION_ONBOARDING_MACHINE}:${c.get("userId")}`;
  logTransition({ event: "session_onboarding.event_received", request_id: requestId,
                  principal_id: c.get("userId") || null, flow_id: flowId, event_type: event.type });

  // ADR-035 failure-simulation AUTHORIZATION gate — distinct from shape validation.
  if (event.type === "__force_failure__" &&
      !shouldInject(KNOB.forceFailureOnAuthRetry,
                    { event: { type: event.type }, correlationId: requestId, serviceName: "ui-state" }))
    return c.json({ error: "failure-simulation knob disabled: …" }, 403);

  const result = await flowOrchestrator.send(translateWireEvent(event, flowId, requestId));
  return serializeResult(c, result, "event_failed");
});
```

Net change vs current: the `tag`-shape `if` and the `org_name`-string `if` are deleted; both become
schema arms. The 403 gate stays (it is an ADR-035 policy decision, not parsing — do not fold it into
zod). Domain invariants (empty name) continue to flow through `constructOrgName` → projection
validation error → existing `serializeResult`/Result mapping at HTTP 200.

## 4. Honoring D-E1 / ADR-028 / hexagonal

- **D-E1 preserved (not revisited):** translation stays at the ACL; the only domain coupling is the
  *reused* `isUnderlyingCauseTag` predicate (D-E2, already export-widened). `constructOrgName` keeps
  the name rule; the empty-string → 200 contrast still holds because zod only checks string-ness.
- **ADR-028 / hexagonal:** nothing new leaks into the machine-agnostic orchestrator — `send()` still
  receives the same `SendEventInput` from `translateWireEvent`. Validation and translation remain at
  the port boundary; the core is untouched.
- **No D-E1 revisit warranted.** The two `if`s were always ACL concerns mis-expressed as imperative
  checks; the fix re-homes them *within* the ACL (into zod), not into the domain. D-E1's line is
  unchanged.

## 5. Comment style

Drop the per-line block comments inside the handler (the `flowId` derivation essay, the audit-log
note, the two payload-rule essays). Replace with a succinct route-group docstring that states
behavior + links ADRs, and let the discriminated union + `translateWireEvent` name carry the intent.

Docstring should cover (≤ ~8 lines): what `/event` does (forward one event to the caller's own
already-running flow); identity is derived, never accepted (ADR-040); the `__force_failure__` gate
(ADR-035); that payload shapes are validated by the schema and domain rules by the value object
(D-E1); links: ADR-028, ADR-035, ADR-040, ADR-041.

Delete: the ~6-line `flowId` derivation comment (the name + ADR link suffice), the audit-log
paragraph, both payload `if` essays (the schema arms self-document), and the "OQ-E3 INCREMENTAL"
note once the union lands (it described a delivery sequence now complete).

## 6. Risks / open questions

1. **Discriminated union closes the event vocabulary.** Any `type` not in the union now 400s at the
   ACL (today an unknown `type` passes through and XState v5 silently ignores it). Confirm no caller
   relies on posting an unmodeled event and getting 200. If an open vocabulary is required, use a
   union for the known arms + a passthrough catch-all arm. (Likely desirable to close it — silent
   ignore is a worse contract — but it is a behavior change, so it needs a characterization test.)
2. **`.refine(isUnderlyingCauseTag)` issue path.** Confirm the emitted zod issue still carries a
   `path`/`message` shape the FE/harness assert on (current hand-rolled error uses
   `path: ["payload","tag"]`). A `z.enum([...UnderlyingCauseTag])` driven from the domain union would
   give a cleaner path but risks re-listing the tags — prefer `.refine` over the predicate to keep
   one source of truth (D-E2).
3. **In-flight `correlation_id` → `request_id` rename.** The sketch uses `request_id`; reconcile with
   whatever the concurrent refactor lands. Structural recommendation is independent of the field name.
4. This is a behavior-adjacent refactor (risk 1) — sequence it as a DISTILL slice with a
   characterization test for the unknown-`type` case before the union lands (CLAUDE.md Iron Rule).
