# Cyrus webhook ingress — AWS CDK (Python)

The public edge of the pull-based pipe. Linear can't reach the local Cyrus daemon
directly, so this stack stands up a publicly reachable endpoint that buffers
webhooks into a queue; the local pump (`../proxy`, `../webhook_feeds`) drains it.

```
Linear  ──HTTPS POST──▶  Lambda Function URL (CyrusIngressHandler)
                              │  verify Linear-Signature (HMAC-SHA256)
                              ▼
                         SQS LinearWebhookQueue ──(5 fails)──▶ LinearWebhookDLQ
                              ▲
        local pump  ──ReceiveMessage / DeleteMessage (CyrusPumpConsumePolicy)
```

## What it provisions

| Construct | Resource | Purpose |
|---|---|---|
| `LinearWebhookQueue` (+ `LinearWebhookDLQ`) | SQS | buffers verified webhooks; redrives to DLQ after 5 receives |
| `LinearWebhookSecret` | Secrets Manager | the `Linear-Signature` HMAC key the handler verifies against |
| `CyrusIngressHandler` | Lambda (py3.12) + Function URL (`AuthType: NONE`) | verifies the signature, enqueues raw body + Linear headers |
| `CyrusPumpConsumePolicy` | IAM managed policy, **attached to nothing** | drain/ack rights on the queue — attach it to the DevPod role yourself |

The signature scheme is the one module `../proxy/linear_signature.py`, symlinked
into `ingress/` so the Lambda verifies exactly as the canary signs. The handler is
dependency-free (boto3 is in the runtime), so `Code.from_asset` zips the folder
with no Docker bundling.

## Layout

```
infra/
├── app.py                    # CDK app entry (see cdk.json)
├── cdk.json
├── stacks/ingress_stack.py   # CyrusIngressStack
├── ingress/                  # the Lambda asset (zipped as-is)
│   ├── handler.py
│   └── linear_signature.py   # → symlink to ../../proxy/linear_signature.py
└── tests/                    # handler unit tests (boto3 Stubber) + stack assertions
```

## Develop

```bash
# tests (handler + synthesized-template assertions)
uv run --no-project --with aws-cdk-lib --with constructs --with boto3 --with pytest pytest -q
```

## Deploy (operator)

```bash
npm i -g aws-cdk                 # CDK CLI is Node-based even for a Python app
uv venv && uv pip install -e '.[dev]'
cdk bootstrap                    # once per account/region
cdk deploy

# then, post-deploy:
#  1. put the Linear webhook secret into LinearWebhookSecret (Secrets Manager)
#  2. register the WebhookUrl output as the Linear webhook URL
#  3. attach the PumpConsumePolicyArn output to the DevPod EC2 instance role
#  4. point the pump at the QueueUrl output (CYRUS_PROXY_QUEUE_URL)
```

This stack is intentionally decoupled from DevPod: it emits the consume policy's
ARN but never references the instance role — you attach it by hand (step 3).
