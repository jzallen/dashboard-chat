# DISTILL — Acceptance Spec: Reframe ingress Lambda as clean-architecture controller + strategies

**Wave:** DISTILL · **Type:** behaviour-preserving refactor (brownfield) ·
**Driving port:** `process(event, *, queue_url, secret, sqs_client, …, delivery_mode, is_offline)` in `cyrus/infra/ingress/handler.py`
**Baseline:** `cyrus-iot-feed/release-1` with the natural-key routing / delivery-mode seam / offline→503 machinery merged in (`consumers.py`, `presence.py`, the `delivery_mode` composition root). 62 ingress tests green.

## Framing

This is a **rename + light-structure** refactor. There is **no new behaviour** and **no walking skeleton** — the end-to-end path already exists and is green. DISTILL's job here is to split the acceptance surface into two kinds of scenario:

1. **Behaviour-preservation guardrails** — scenarios that already pass on the baseline and MUST stay green with **no weakened or deleted assertions** through the refactor. These are the existing 62 ingress tests; the four load-bearing invariants are each already pinned (table below). The Iron Rule applies: never weaken these to make the refactor "fit".
2. **Structural specifications (RED today)** — scenarios that assert the *target* clean-architecture shape (pure identity VO, presence `Protocol`, presenter separation, named strategy use cases, `delivery_mode` only at the composition root). These are RED against today's ABC-based code and drive the DELIVER passes. They are authored as plain `pytest` in the existing `service__condition__outcome` style — **no `pytest-bdd` / `.feature` ceremony**, because the issue mandates boto3 + stdlib only and forbids new packages.

The Gherkin below is the **scenario SSOT in documentation form**; each scenario maps to a concrete pytest test (existing or new). Steps use business language; the technical binding lives in the test bodies.

---

## Behaviour-preservation guardrails (existing — must stay green)

All scenarios enter through the **controller** `process()` (or `handler()` for the wiring tests). They are already green on the baseline.

### The four load-bearing invariants

| Invariant | Given–When–Then (business language) | Pinned by (existing test) |
|---|---|---|
| **Opaqueness** | Given a validly signed webhook · When it is delivered in dual-write · Then the bytes published to IoT and enqueued to SQS are byte-identical to the bytes that were signature-verified | `test_handler_iot_dual_write.py::test_process__dual_write_valid_webhook__published_and_enqueued_bytes_match_received_body` |
| **`_unrouted` ≠ offline** | Given a webhook with no derivable consumer key · When delivered in iot-only · Then it is published to the `_unrouted` catch-all and is **never** a 503 | `test_handler_delivery_mode.py::test_process__iot_only_unrouted__publishes_catch_all_and_never_503` |
| **Fail-closed presence** | Given the presence read errors (throttle/network/IAM) · When an addressed consumer is checked · Then it is treated as offline | `test_presence.py::test_make_offline_check__read_errors__fails_closed_to_offline` (+ end-to-end `test_handler_iot_only_wiring.py::test_handler__iot_only_with_offline_presence_row__returns_503_and_skips_sqs`) |
| **Honest-503 body** | Given a routed consumer the presence read calls offline · When delivered in iot-only · Then the response is `503` with body exactly `{reason: "consumer-offline", consumer_id, action}` | `test_handler_delivery_mode.py::test_process__iot_only_routed_and_offline__returns_503_naming_consumer_and_action` |

### Other behaviour that must not regress (representative)

- Missing / invalid signature → `401`, nothing published or enqueued (`test_handler.py`, `test_handler_iot_dual_write.py::…invalid_signature…`).
- Base64 transport body decoded before verify+enqueue (`test_handler.py`).
- iot-only + online → publish to the username topic, `200`, no SQS (`test_handler_delivery_mode.py`, `test_handler_iot_only_wiring.py`).
- iot-only publish failure → propagates, never falls back to SQS (`test_handler_delivery_mode.py`).
- dual-write transient IoT failure → SQS still enqueues, `200` (`test_handler_iot_dual_write.py`).
- Unknown / omitted `DELIVERY_MODE` → dual-write safety net wins (`test_handler_delivery_mode.py`, `test_handler_iot_only_wiring.py`).
- Offline path emits a structured log with `consumer_id` + `creator.id` (`test_handler_offline_observability.py`).

---

## Structural specifications (RED today → GREEN after DELIVER)

These encode the clean-architecture ACs. They live in `cyrus/infra/tests/test_clean_architecture_refactor.py`, authored RED and `@pytest.mark.skip`-gated (each test imports its target symbol *inside the body* so collection stays green while the symbol does not yet exist). The DELIVER crafter **enables one at a time** and finalises the names (the issue grants naming discretion — the suggested names below are not load-bearing).

| # | Acceptance criterion | Scenario (Given–When–Then) | Proposed test |
|---|---|---|---|
| S1 | **Identity is a pure VO** | Given a signed body · When consumer identity is derived · Then the identity holds the routing key + `is_routed` only, performs no I/O, is immutable and equality-comparable, and **stores no body bytes** | `test_consumer_identity__holds_key_and_is_routed_only_no_body` |
| S2 | **`_unrouted` identity is not routed** | Given a body with no derivable key · When identity is derived · Then `is_routed` is `False` (and the addressed-consumer use case skips the presence check entirely) | `test_consumer_identity__unrouted_key__is_not_routed` |
| S3 | **Presence is a Protocol** | Given the presence boundary · Then it is modelled as a `Protocol` (`is_offline(username: str) -> bool`) with fail-closed-in-adapter documented in a docstring; the DynamoDB-backed `make_offline_check` satisfies it | `test_presence__is_modeled_as_a_protocol` |
| S4 | **Presenter separated** | Given a use case returns a domain result · When the controller shapes the response · Then a single presenter maps result → `HTTPResponse`, and **no `statusCode`/HTTP literal is produced inside any use-case function** | `test_presenter__is_the_sole_producer_of_http_status` |
| S5 | **Strategies are named use-case functions** | Given the two delivery paths · Then each is a function named for its single responsibility (`relay_webhook_event_to_consumer`, `enqueue_webhook_event`); the buffer name/structure does not hide its optimistic IoT probe | `test_strategies__exist_as_named_use_case_functions` |
| S6 | **`delivery_mode` at the composition root** | Given the controller/factory · Then `delivery_mode` is read once there and selects the strategy; **no use-case function branches on `delivery_mode`** | `test_use_cases__do_not_branch_on_delivery_mode` |

S4 and S6 are verifiable by source introspection of the use-case functions (the property is *absence* of a token), so they remain meaningful even before names are finalised.

---

## Adapter coverage (Mandate 6)

The ingress Lambda's only driven adapters are exercised with real I/O via botocore `Stubber` (the project's stand-in for real AWS calls):

| Driven adapter | Real-I/O scenario | Covered by |
|---|---|---|
| SQS (`send_message`) | YES | `test_handler.py`, `test_handler_iot_dual_write.py` (botocore Stubber) |
| IoT Data-plane (`publish`) | YES | `test_handler_iot_dual_write.py`, `test_handler_delivery_mode.py` (Stubber) |
| DynamoDB presence (`get_item`) | YES | `test_presence.py`, `test_handler_iot_only_wiring.py` (Stubber) |

No new adapters are introduced by this refactor, so no new adapter-integration scenarios are required.

## Out of scope (per issue)

No behaviour change; dual-write not retired; no `ingress_stack.py` change; secret rename tracked separately. The conditional-IaC payoff is forward-looking only and is **not** an acceptance criterion here.
