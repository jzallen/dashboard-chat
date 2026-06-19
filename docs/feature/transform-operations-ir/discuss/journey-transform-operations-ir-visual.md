# Journey (visual) — Shaping a dataset's staging layer through the operations IR

**Wave:** DISCUSS · **Area:** backend · **Job:** JOB-003 · **Provisional SSOT journey:** J-005 (Transform toggles)

The "user" here is a **chat-driven author or an agent** issuing model changes to
a dataset's staging layer, plus the **Excel→M import** entry point. The journey
is backend-observable: every step has an HTTP entry point and a concrete
response. ibis/SQL are always on the *derived* side; the persisted operations
list is the only authority.

## Mental model (author's vocabulary)

- "I describe **changes** to my columns (trim, lowercase, rename, fill blanks,
  drop rows that don't match)."
- "The system applies them **in the order I gave**, and shows me the result."
- "If I **import from Excel**, it should mean the *same thing* as if I'd typed it."
- "If I get something wrong, it should tell me **right away** — not show me a
  broken preview later."

The author does not think in "ibis", "MUTATE/FILTER/RENAME stages", or "M dialect
deltas". Those are render concerns the IR keeps internal.

## Happy path + emotional arc

```
 STEP 1            STEP 2             STEP 3              STEP 4              STEP 5
 Author/agent  →   Boundary       →   Preview render  →   Reorder /        →   Import from
 submits ops       validation         (deterministic)     re-submit            Excel (M)
 ───────────       ───────────        ───────────         ───────────          ───────────
 POST /transforms  rejected if        POST /preview       PATCH /transforms    POST /import-m
 (or import)       malformed          GET ?include_       (new sequence)       (bounded subset)
                   422 structured     preview=true
 persisted with    ───────────        staging SQL in      SQL reflects new     supported → ops
 explicit sequence valid → persisted  sequence order      order; swap two      unsupported →
                                                           MUTATE ⇒ diff SQL    rejected BY NAME

 emotion:          emotion:           emotion:            emotion:             emotion:
 "will this        "good — it         "this is exactly    "order held —        "it imported what
  hold?"            caught it          what I meant"        I'm in control"      it could and told
  (uncertain)       at submit"         (confident)          (in control)         me the rest"
                    (reassured)                                                  (trusting)

 confidence:  ▁▁▁▁▁▁▁▁→▃▃▃▃▃▃→▅▅▅▅▅▅→▆▆▆▆▆▆→███████  (builds monotonically)
```

## Error / recovery paths

| Where | Failure | System response | Recovery |
|---|---|---|---|
| Step 2 | Operation missing a required field, or unknown discriminator value | `422` with a structured error naming the field/discriminator; **nothing persisted** | Author fixes the operation and resubmits; no half-written state to clean up |
| Step 3 | (Invariant guard) renderer cannot render a persisted operation | Should be **unreachable** for validated operations; the `-- Error generating SQL` fallback becomes a guard, not the validation layer | If ever hit, it is a build/probe failure (see Step 0), not a customer-visible silent degrade |
| Step 0 (build time) | A visitor is missing an entry for an operation discriminator | **Renderer-completeness probe fails the build** | Developer adds the catalog entry before merge; a silent skip can never ship |
| Step 5 | M script contains an out-of-vocabulary construct (join, pivot, type engine) | `422` (or structured import error) **naming the unsupported construct**; **no partial import** | Author removes/rewrites the unsupported step; supported subset can be re-imported cleanly |

## Step → expected output table

| Step | Entry point | Expected observable output |
|---|---|---|
| 1 Submit | `POST /api/datasets/{id}/transforms` | `200/201` JSON listing created operations, each with its assigned `sequence` |
| 2 Validate | (same call, pre-persist) | Valid → persisted; malformed → `422` structured error, body names offending field/discriminator |
| 3 Preview | `POST /api/datasets/{id}/transforms/preview` or `GET /api/datasets/{id}?include_preview=true` | Staging SQL string rendered in `sequence` order; byte-identical across repeated calls |
| 4 Reorder | `PATCH /api/datasets/{id}/transforms` (new sequence) | Re-rendered SQL reflects the new order; swapping two MUTATE ops on one column yields different SQL |
| 5 Import | `POST /api/datasets/{id}/transforms/import-m` *(new endpoint, Slice 5)* | Supported subset → created operations (as Step 1); unsupported construct → structured rejection naming it |

See `journey-transform-operations-ir.yaml` for the machine-readable schema,
`journey-transform-operations-ir.feature` for Gherkin, and
`shared-artifacts-registry.md` for the `${variable}` source-of-truth table.
