# DISTILL — Wave Decisions: Reframe ingress Lambda as clean-architecture controller + strategies

Numbered decisions taken while distilling the design into acceptance tests. Referenced by `roadmap.json` (`decisions_ref`).

## DWD-1 — Baseline recut onto `release-1`, not `main`

The work branch was originally cut from `main`, where the ingress Lambda is the pre-skeleton dual-write baseline (`handler.py` only — no `consumers.py` / `presence.py` / `delivery_mode`). The natural-key routing + delivery-mode seam + offline→503 machinery this refactor reframes lives on `cyrus-iot-feed/release-1` (merged there via the completed observability-cutover story). The branch was recut onto `release-1` (tip carries the merged skeleton); `process()` now exposes the `delivery_mode` composition-root seam and the 62 ingress tests are green. This satisfies the issue's "based on the right branch" criterion. **Re-validation:** the merged shapes match the issue's Contracts section exactly (VO-precursor in `_LinearConsumer`, `presence.row_is_offline` fail-closed, `_offline_response` body `{reason, consumer_id, action}`), so no plan re-validation was required.

## DWD-2 — Refactor framing, not feature framing (no walking skeleton)

This is a behaviour-preserving rename/restructure. There is no walking skeleton to build — the end-to-end path exists and is green. DISTILL therefore produces (a) a **behaviour-preservation guardrail** set = the existing 62 tests, with the four load-bearing invariants explicitly mapped, and (b) a **structural specification** set (RED today) that asserts the target clean-architecture shape and drives DELIVER. Mandate 5 (walking skeleton) is N/A and recorded as such.

## DWD-3 — No `pytest-bdd` / `.feature`; plain pytest in existing style

The issue mandates a flat, dependency-free Lambda asset (boto3 + stdlib only, the folder zips as-is) and forbids new package ceremony. Introducing `pytest-bdd` + `.feature` files would violate both. Decision: the Gherkin scenarios live as **documentation** in `acceptance-spec.md`; the executable specs are plain `pytest` in the established `service__condition__outcome` naming, colocated in `cyrus/infra/tests/` so they import the flat modules (`import consumers`, `import handler`) and run under `uv run --extra dev pytest`.

## DWD-4 — Adapter strategy: real botocore Stubber (Strategy C-equivalent)

The ingress driven adapters (SQS, IoT Data-plane, DynamoDB presence) are exercised with botocore `Stubber` against real client call shapes — the project's existing real-I/O stand-in for AWS. No InMemory doubles, no `@requires_external`. This matches the baseline tests and needs no new wiring.

## DWD-5 — Structural specs are throwaway DRIVERS, not kept tests; deleted at end of DELIVER

The new structural specs (S1–S6) assert symbols that do not yet exist (pure identity VO, presence `Protocol`, named use-case functions, presenter). They exist **only to drive the refactor** and are **removed in the final DELIVER step** (roadmap step 6). Rationale: they assert implementation *shape* (a VO holds no body, a function has no `statusCode` literal, presence is a `Protocol`) — brittle structure-coupling that adds no behavioural value once the shape exists. For a behaviour-preserving "move things around" refactor, the **existing 62 tests are the behavioural contract** and already prove behaviour is unchanged; the clean-architecture *shape* is confirmed by a **refactor/architecture review of the diff** (e.g. `nw-solution-architect-reviewer` / `nw-software-crafter-reviewer`), not by a standing test. Net test delta of the whole refactor is therefore **zero**.

While they exist, each is `@pytest.mark.skip`-gated and imports its target symbol **inside the test body**, so collection stays green and the 62 baseline tests are untouched. DELIVER enables them one at a time and finalises names (the issue grants naming discretion — suggested names are not load-bearing). S4 (no `statusCode` literal in a use case) and S6 (no `delivery_mode` branch in a use case) are written as **source-introspection** assertions so they remain meaningful regardless of final names. If a DELIVER step were ever to introduce genuinely new *behaviour*, that would instead be pinned by a normal behavioural test that stays — but this refactor introduces none.

## DWD-6 — Fail-closed presence stays adapter-owned (documented)

Per the issue's Contracts, the presence `Protocol` returns a boolean and the **adapter** owns the fail-closed policy (a read error → offline), preserving current `presence.make_offline_check` behaviour. The purer "repo returns Unknown, use case decides" option is explicitly **not** taken. The choice is to be documented in the Protocol/adapter docstring (roadmap step 2). The fail-closed→503 behaviour is pinned by an existing guardrail test.

## DWD-7 — Iron Rule on the 62 guardrails

The existing ingress tests are the behaviour contract. They must stay green through every DELIVER step with **no weakened or deleted assertions**. `process()`'s public signature is depended on by these tests; any change is deliberate, called out, and the tests are updated in lockstep — never loosened. After 3 failed attempts on any step, revert and escalate.

## Reconciliation

Wave-decision reconciliation passed — **0 contradictions**. The issue (carrying DISCUSS/DESIGN-level detail) is the upstream source; its Contracts and Invariants sections agree with the merged `release-1` code shapes. No prior-wave `docs/feature/.../{discuss,design}` artifacts exist for this slug (brownfield refactor entered at DISTILL per the issue's instruction), so traceability is to the issue's Acceptance Criteria, mapped in `acceptance-spec.md`.
