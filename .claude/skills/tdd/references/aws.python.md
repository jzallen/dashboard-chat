# Mocking AWS (boto3) in Python tests with botocore Stubber

How to unit-test code that calls AWS via `boto3`, using `botocore.stub.Stubber`. The
Stubber intercepts calls on a real client and returns canned responses **after running
botocore's own request serialization and parameter validation** — so it catches
malformed requests that a hand-rolled mock would not.

> When to use what: prefer the **Stubber** for targeted unit tests of a specific AWS
> interaction. The backend already auto-mocks **S3 via `moto`** (no setup needed) — use
> that for code exercising S3 broadly. Reach for the Stubber when you want to assert the
> exact request params of a specific call.

## Stubber vs MagicMock: pick by what you're verifying

Both keep the test offline — the Stubber intercepts the call before the wire, and a
`MagicMock` never had a wire. They differ in what they prove, so choose per test:

- **Stubber — when you're verifying the wire contract or a parsed response.** It runs
  botocore's real request serialization + parameter validation and returns a realistically
  shaped response, so it catches malformed requests (typo'd/invalid params, wrong types)
  and lets you assert how your code parses the response. Use it for reads
  (`receive_message`, `get_object`, …) and anywhere the request/response *structure* is
  part of what you're testing.
- **MagicMock — for a happy-path side-effect on a fire-and-forget call.** When the call
  returns nothing you care about and you only need to prove "the unit asked the client to
  do X with these args," a `MagicMock` injected at the port boundary plus
  `assert_called_once_with(...)` says exactly that, more directly than the Stubber's
  `expected_params` + `assert_no_pending_responses()` pairing:

  ```python
  def test_acknowledge_deletes_message_at_sqs_boundary_with_receipt_handle() -> None:
      sqs_client = MagicMock()
      message = make_linear_webhook_message()
      feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=sqs_client)

      feed.acknowledge(message)

      sqs_client.delete_message.assert_called_once_with(
          QueueUrl=QUEUE_URL,
          ReceiptHandle=message.receipt_handle,
      )
  ```

  The cost: a bare `MagicMock` accepts *any* call — a misspelled method or invalid params
  won't error — so you're trusting your own understanding of the API, not botocore's.
  That's an acceptable trade for a happy-path side-effect check; **leave request/response
  invariants to the Stubber-based tests** (or a dedicated invariant test), and say so in a
  short docstring on the MagicMock test so the deliberate looseness is explicit.

- **moto — only when the test genuinely needs queue/bucket *state*** (and even then,
  prefer asserting your own behavior over AWS's). Do **not** track queue depth to verify a
  delete: visibility, redelivery, and counts are AWS's responsibility, not your unit's —
  asserting them tests moto, not your code. The side-effect call assertion above is what
  you actually own.

A file may mix styles — that's fine when each test uses the tool that matches what it
verifies. Note it in the module docstring so the mix is intentional and legible.

## Inject the client; default to the real one

The unit under test should accept an injected client and default to a real one, so tests
can substitute a stubbed client without patching:

```python
class SQSLinearWebhookFeed:
    def __init__(self, queue_url: str, sqs_client: Any | None = None) -> None:
        self._queue_url = queue_url
        self._sqs_client = sqs_client if sqs_client is not None else boto3.client("sqs")
```

## Build a stubbed client in a fixture

A real client is required even in tests — construct it with a region and **dummy
credentials** so no AWS environment/config is needed, attach a `Stubber`, and yield both:

```python
@pytest.fixture
def stubbed_sqs():
    client = boto3.client(
        "sqs",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    stubber = Stubber(client)
    yield client, stubber
    stubber.deactivate()
```

## Queue responses and assert request params

- `stubber.add_response(operation_name, service_response, expected_params=...)` queues one
  canned response. `expected_params` makes the Stubber **assert the call's arguments** —
  if the code sends different params, botocore raises.
- Operations are queued in FIFO order; queue one `add_response` per expected call.
- For operations that return an empty body on success (e.g. `delete_message`), pass `{}`
  as the response.
- Activate the stub with the `with stubber:` context manager (or `stubber.activate()`).

```python
def test_acknowledge_deletes_message_at_sqs_boundary_with_receipt_handle(stubbed_sqs):
    client, stubber = stubbed_sqs
    message = make_linear_webhook_message()
    stubber.add_response(
        "delete_message",
        {},
        expected_params={"QueueUrl": QUEUE_URL, "ReceiptHandle": message.receipt_handle},
    )
    feed = SQSLinearWebhookFeed(queue_url=QUEUE_URL, sqs_client=client)

    with stubber:
        feed.acknowledge(message)

    stubber.assert_no_pending_responses()
```

## `assert_no_pending_responses()` is the boundary assertion

For a call with **no meaningful return value** (delete/put/tag operations), the
specification is "the right AWS request fired." That is verified by `expected_params` plus
**`stubber.assert_no_pending_responses()`**, which fails if any queued response went
unconsumed (i.e. the expected call never happened). This is the single, correct assertion
for such tests — don't bolt on a weak `assert result is None`.

For calls that **do** return data, asserting on the parsed return value already proves the
call happened, so a trailing `assert_no_pending_responses()` is redundant — keep the one
value assertion.

## Self-consistency

Keep the test self-consistent: pull identifiers the request must echo (e.g.
`ReceiptHandle`) from the object under test (`message.receipt_handle`) rather than a
separate fixture, so the expectation can't silently drift from the input.

## Response-shape gotchas

- The `service_response` must be shaped like the real API response (correct keys, correct
  nesting), or the Stubber rejects it. Capture a real response shape once if unsure.
- An "empty" poll often means the key is simply **absent** (e.g. SQS `receive_message`
  with no messages returns a dict with no `Messages` key), not an empty list — model that
  faithfully in the fixture.
