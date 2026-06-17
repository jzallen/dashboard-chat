# Cyrus on this machine

**Status:** Phase 0 built. The SQS→Cyrus pump (feed + forwarder + execution loop) is
implemented and runnable via `python -m proxy`, with a **canary** feed for AWS-free
smoke tests (see [Running it](#running-it)). The cloud pipe (Phase 1) is still the
design sketch described below.

This folder is **not part of the Dashboard Chat application.** It's the home for
running [Cyrus](https://www.atcyrus.com/) — the Claude Code background agent for
Linear — on the same machine (this devpod) that hosts this repo's code. Keeping it
in-tree means the agent's config, the proxy glue, and the IaC live next to the code
the agent will actually work on.

---

## The idea

Cyrus turns Linear issues assigned to it into branches/PRs by running Claude Code
sessions in isolated git worktrees. We want to drive it from **our own** Linear
OAuth app (not Cyrus's hosted proxy), all on AWS, while the devpod stays ephemeral.

The problem: a self-hosted Cyrus normally needs a **public URL** for Linear's OAuth
callback + webhooks. Our devpod has no stable public URL and is off when we're not
working. So we invert the flow — **Cyrus reaches out to a queue; nothing reaches in
to the devpod:**

```
Linear ──webhook──▶ Lambda (Function URL, always-on, public)
                      ├─ verify Linear-Signature, return 200 in <100ms
                      └─ enqueue raw body + headers ──▶ SQS  (durable, ~14d retention)

        ┌──── devpod (this machine), whenever it's up ────┐
        │  cyrus            — the daemon (direct-webhook mode)
        │  cyrus-sqs-proxy  — long-polls SQS, replays each
        │                     message as an HTTP POST to Cyrus's
        │                     local /linear-webhook endpoint
        └──────────────────────────────────────────────────┘
```

Properties this buys us:

- **No inbound** connectivity to the devpod — only the Lambda is public.
- **No work lost while the devpod is off** — webhooks queue in SQS; Cyrus drains the
  backlog on next start. No `ec2:StartInstances` auto-wake needed; we start the box
  to work, like we already do with the devpod.
- **One box** — Cyrus shares the devpod's EC2 + EBS. No second instance, no EFS.

### How Cyrus actually integrates (so we know what the proxy must mimic)

- **Linear**: OAuth app + webhooks. Cyrus routes by request path — `/linear-webhook`
  is its Linear route (`/github-webhook` and `/callback` are separate handlers; the
  bare `/webhook` is a deprecated legacy alias). It verifies the `Linear-Signature`
  header (hex HMAC-SHA256 of the **raw request body** using the webhook signing
  secret) and does source-IP validation (`WEBHOOK_IP_VALIDATION`, on by default with
  `CYRUS_HOST_EXTERNAL=true`). Routes are documented in the Cyrus self-hosting guide
  (see References).
- **GitHub**: no GitHub App required for the core flow — Cyrus shells out to `git` +
  the `gh` CLI as the box's authenticated user. PRs via `gh pr create`; commits carry
  the box's `git config` identity. Auth = an SSH key (push) and/or a `gh` PAT.
- **Config/state**: `~/.cyrus/config.json` + `~/.cyrus/` (tokens, sessions,
  worktrees). On the devpod this must live on the **persistent EBS mount** so it
  survives an ephemeral rebuild.

> Still to confirm during the spike: the precise Linear **agent-session** webhook
> *type* Cyrus expects when an issue is assigned to the agent (Agent Session events
> via Linear's Agent SDK, not plain issue webhooks). The replay route is confirmed:
> `/linear-webhook`.

---

## Running it

The pump is implemented as the `proxy` package (execution loop, HTTP forwarder,
config) plus feed adapters in `webhook_feeds/`. Run it with:

```bash
python -m proxy
```

It reads all settings from the environment, assembles the feed + forwarder, and polls
until SIGINT/SIGTERM (graceful shutdown). Logs go to stderr at `CYRUS_PROXY_LOG_LEVEL`.

### Smoke test without AWS (canary feed)

The `canary` feed emits one synthetic Linear webhook and forwards it to your local
Cyrus — no SQS/AWS needed — so you can validate the replay path (the "does Cyrus
receive it?" goal):

```bash
CYRUS_PROXY_FEED=canary \
CYRUS_PROXY_BASE_URL=http://localhost:<cyrus-port> \
CYRUS_PROXY_CANARY_SIGNING_SECRET=<cyrus-webhook-secret> \
python -m proxy
```

With the signing secret set, the canary signs its body so Cyrus's `Linear-Signature`
check passes; omit it for a transport-only check (Cyrus receives the POST but rejects
the signature). It emits once, then idles.

### Real SQS

Omit `CYRUS_PROXY_FEED` (defaults to `sqs`) and point it at the queue the Lambda feeds
(Phase 1):

```bash
CYRUS_PROXY_BASE_URL=http://localhost:<cyrus-port> \
CYRUS_PROXY_QUEUE_URL=https://sqs.<region>.amazonaws.com/<acct>/<queue> \
python -m proxy
```

AWS credentials come from the usual boto3 sources (the devpod's instance role).

### Real IoT (identity-routed MQTT5)

Set `CYRUS_PROXY_FEED=iot` to consume your own keyed stream over a live AWS IoT
MQTT5-over-WebSocket connection. The connection is signed with SigV4 from the **default
AWS credential chain** (the devpod instance role — **no X.509 device certs**), subscribes
to exactly `cyrus/v1/sessions/<routing-key>` at QoS 1, and acknowledges each message
**manually** only after a clean forward — so a failed forward is redelivered (the same
at-least-once contract as SQS):

```bash
CYRUS_PROXY_FEED=iot \
CYRUS_PROXY_BASE_URL=http://localhost:3456 \
CYRUS_PROXY_IOT_ENDPOINT=<account>-ats.iot.<region>.amazonaws.com \
CYRUS_PROXY_IOT_ROUTING_KEY=<your-linear-creator-id> \
CYRUS_PROXY_IOT_REGION=<region> \
python -m proxy
```

The region is optional — it falls back to `AWS_REGION`/`AWS_DEFAULT_REGION`, then to the
region embedded in the ATS endpoint host. The forwarded Linear headers (including
`Linear-Signature`) travel as MQTT5 **user properties** on the publish, so the forwarded
body verifies at Cyrus unchanged.

#### End-to-end smoke run (against a real endpoint)

This is the DC-22 elevator-pitch demo on the live path. Requires the ingress Lambda's
IoT dual-write enabled (`IOT_ENDPOINT` set) and a devpod whose instance role allows
`iot:Connect` / `iot:Subscribe` / `iot:Receive` on `cyrus/v1/sessions/<key>` and
`iot:Publish` for the publisher leg.

1. Start your local Cyrus daemon (see below) and note `LINEAR_WEBHOOK_SECRET`.
2. Run the pump with the `iot` env block above (`ROUTING_KEY` = the `creator.id` you
   want to receive).
3. Publish a signed webhook to `cyrus/v1/sessions/<key>` — either trigger a real Linear
   `AgentSessionEvent` for that creator through the ingress Lambda, or publish directly
   with the AWS CLI carrying the headers as user properties and QoS 1, e.g.:
   ```bash
   aws iot-data publish \
     --topic "cyrus/v1/sessions/<key>" --qos 1 \
     --payload "$(cat body.json | base64)" \
     --user-properties '[{"Linear-Signature":"<hex-hmac-of-body>"},{"Linear-Event":"AgentSessionEvent"}]'
   ```
4. Confirm the pump logs a forwarded session and that `curl localhost:3456/linear-webhook`
   (Cyrus's log) shows it **passing signature verification**.
5. To prove manual ack: make the forward fail (stop Cyrus) and observe the message
   redeliver on the next poll; restart Cyrus and observe a single ack on success.

The default test suite never touches AWS — the connection is built lazily only on the
first `receive()`, and all unit tests drive a fake client.

### Settings (environment variables)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CYRUS_PROXY_BASE_URL` | yes | — | where the local Cyrus daemon listens; the forwarder POSTs to `<base>/linear-webhook` |
| `CYRUS_PROXY_FEED` | no | `sqs` | which feed to run: `sqs`, `canary` or `iot` |
| `CYRUS_PROXY_QUEUE_URL` | yes (sqs) | — | SQS queue to poll |
| `CYRUS_PROXY_MAX_MESSAGES` | no | `10` | messages per poll (SQS cap) |
| `CYRUS_PROXY_WAIT_SECONDS` | no | `20` | SQS long-poll wait per receive |
| `CYRUS_PROXY_ERROR_BACKOFF_SECONDS` | no | `5.0` | sleep after a failed cycle (only on error) |
| `CYRUS_PROXY_LOG_LEVEL` | no | `INFO` | process log level |
| `CYRUS_PROXY_CANARY_SIGNING_SECRET` | no | — | (canary) sign the body's `Linear-Signature` |
| `CYRUS_PROXY_CANARY_IDLE_SECONDS` | no | `20` | (canary) idle sleep after emitting |
| `CYRUS_PROXY_IOT_ENDPOINT` | yes (iot) | — | (iot) AWS IoT ATS data-plane endpoint host |
| `CYRUS_PROXY_IOT_ROUTING_KEY` | yes (iot) | — | (iot) this consumer's `creator.id`; subscribes to `cyrus/v1/sessions/<key>` |
| `CYRUS_PROXY_IOT_REGION` | no | — | (iot) SigV4 signing region; falls back to `AWS_REGION` then the endpoint host |

Run the tests with `cd cyrus && uv run --no-project pytest -q`.

---

## Running Cyrus locally (the pump's target)

To exercise the pump end-to-end you need a local Cyrus daemon listening on
`/linear-webhook`. Because our pump delivers **to localhost**, we skip the public
tunnel the [official guide](https://github.com/cyrusagents/cyrus/blob/main/docs/SELF_HOSTING.md)
centers on — a public URL would only be needed for Linear→Cyrus delivery (our pump
replaces it) and the one-time OAuth callback (which uses `http://localhost:3456/callback`).

Prereqs are already on the devpod (Node 20, `gh`, `jq`, `claude`). Setup:

1. **Install:** `npm install -g cyrus-ai`
2. **Config:** settings live in `~/.cyrus/.env` (Cyrus loads it on startup). The
   local-mode plumbing is `LINEAR_DIRECT_WEBHOOKS=true`, `CYRUS_BASE_URL=http://localhost:3456`,
   `CYRUS_SERVER_PORT=3456`, and `WEBHOOK_IP_VALIDATION=false` (so the localhost pump
   isn't rejected as a non-Linear source IP). Then fill in:
   - `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET` — from a Linear
     OAuth app (Settings → API → OAuth Applications; **needs workspace admin**). Enable
     Client credentials + Webhooks, subscribe to **Agent session events**, callback
     `http://localhost:3456/callback`.
   - `CLAUDE_CODE_OAUTH_TOKEN` (via `claude setup-token`) **or** `ANTHROPIC_API_KEY`.
3. **Authorize + add a repo + run:**
   ```bash
   cyrus self-auth-linear                                # browser → localhost callback
   cyrus self-add-repo https://github.com/you/repo.git   # something to route issues to
   cyrus                                                  # listens on :3456
   ```
4. **Point the pump at it** — the canary secret MUST equal Cyrus's `LINEAR_WEBHOOK_SECRET`:
   ```bash
   CYRUS_PROXY_FEED=canary \
   CYRUS_PROXY_BASE_URL=http://localhost:3456 \
   CYRUS_PROXY_CANARY_SIGNING_SECRET=<LINEAR_WEBHOOK_SECRET> \
   python -m proxy
   ```

Caveats to expect:
- **Linear may not allow an `http://localhost` redirect URI.** If `self-auth-linear`
  is rejected, run a one-time ngrok tunnel for that single authorization step only.
- **The canary sends a `Comment` event, but Cyrus subscribes to `AgentSessionEvent`.**
  Cyrus will *verify* the signed canary but won't *act* on a Comment. To trigger real
  processing, capture a genuine `AgentSessionEvent` (assign an issue to Cyrus in Linear,
  watch its logs) and update `_CANARY_BODY` in `webhook_feeds/canary_feed.py` to match.
  This is how we close the last open item below.

---

## Preliminary task — prove the SQS proxy is possible

**We do not build the cloud pipe (Linear → Lambda → SQS) first.** We first answer one
question, locally, with no AWS:

> **Can a small process pull a message off a queue and hand it to a locally-running
> Cyrus such that Cyrus accepts it and begins processing?**

If yes, the SQS proxy is viable and the cloud pipe is "just plumbing." If no, we found
out cheaply, before standing up any infrastructure.

### Approach: the pump

> **Built** as the `proxy` package (`execution_loop`, `http_forwarder`, `config`) +
> `webhook_feeds/` adapters (`sqs_feed`, `canary_feed`). The rationale below is why it
> looks the way it does.

A small process that loops:

1. Long-poll the queue (real SQS in the cloud; a fake locally — see below).
2. For each message: reconstruct the original webhook — **byte-exact raw body** +
   the `Linear-Signature` header (and any other headers Cyrus checks) — and
   `POST` it to Cyrus's local Linear route (e.g. `http://localhost:<CYRUS_SERVER_PORT>/linear-webhook`).
3. On a 2xx (or observed processing start), delete the message. Otherwise let the
   visibility timeout return it (with a DLQ after N tries, in the cloud version).

The pump is deliberately dumb: it does **not** parse or re-sign payloads. It carries
the body and signature through untouched so Cyrus's own verification still works.
That is the whole feasibility bet — that we can replay a webhook into Cyrus's
direct-webhook listener and it's indistinguishable from Linear calling it directly.

### Testing locally without infrastructure

The two things we lack locally are a **valid webhook payload** and a **valid Linear
OAuth token**. We sidestep both, and explicitly scope the spike around the gaps:

| Need | Local stand-in |
|---|---|
| A queue | **ElasticMQ** (lightweight SQS-compatible server) or **LocalStack** — same SQS API, runs in Docker, no AWS account. |
| A webhook payload | Hand-crafted minimal Linear payload (from Linear's documented schema) **or** a captured real one once the OAuth app exists. |
| A valid signature | We **choose the signing secret** locally: set the same test secret in Cyrus's env and in the test harness, and sign the synthetic body with it → a genuinely valid `Linear-Signature`. No real Linear secret needed. |
| Source-IP check | `WEBHOOK_IP_VALIDATION=false` so the pump (not a Linear IP) isn't rejected. |
| A Linear OAuth token | **None.** Cyrus will accept + verify the webhook, start processing, then fail when it tries to call the Linear API back. That failure is **out of scope** for this spike. |

### Success criteria (intentionally narrow)

The spike is **GREEN** when:

- A message placed on the local fake queue is picked up by the pump, and
- Cyrus **receives and accepts** the replayed webhook (signature verification passes,
  request is routed), and
- Cyrus **begins processing** — observable via its logs and/or a git worktree being
  created.

The spike **accepts these failures** as expected, deferred to the cloud-pipe phase:

- Downstream Linear API calls fail (no real OAuth token).
- The payload may not trigger a full, correct agent run (synthetic / minimal payload).

In short: **we are validating delivery + acceptance, not end-to-end issue resolution.**

If we can't get a self-signed synthetic payload accepted, the fallback is to run Cyrus
with signature verification disabled and assert only that the request reached the
`/linear-webhook` route — proving the *transport* even if we can't yet prove *verification*.

---

## Phased plan

- **Phase 0 — SQS-proxy feasibility spike (this folder).** ✅ **Built.** The pump is
  implemented (`proxy/` + `webhook_feeds/`), unit-tested, and runnable via
  `python -m proxy`. The `canary` feed lets you exercise the full receive → forward →
  ack path against a local Cyrus with no AWS (see [Running it](#running-it)). Remaining:
  point the canary at a live Cyrus to confirm the agent-session payload shape it expects.
- **Phase 1 — Cloud pipe.** Lambda Function URL (verify `Linear-Signature` → enqueue →
  200; handle `/callback` OAuth) + SQS + DLQ + IAM. Register our own Linear OAuth app
  pointed at the Lambda URL. Token persisted to Secrets Manager; repo config in SSM.
- **Phase 2 — Run for real on the devpod.** Cyrus + pump as systemd units, `~/.cyrus`
  on the persistent EBS mount, `gh`/SSH identity from Secrets Manager, baked into the
  devpod setup so an ephemeral rebuild comes back wired.

---

## Open questions / unknowns to verify during Phase 0

- [x] Exact Cyrus route the proxy must hit: **`POST /linear-webhook`** (the bare
      `/webhook` is a deprecated alias). Still to confirm: required headers beyond
      `Linear-Signature`.
- [ ] The Linear **agent-session** webhook type/shape Cyrus expects on assignment, so
      our synthetic payload is realistic enough to trigger processing.
- [ ] Whether `WEBHOOK_IP_VALIDATION=false` is sufficient to accept a localhost replay,
      or if other self-host guards apply.
- [ ] SQS at-least-once handling: visibility timeout vs. max Cyrus run time, and
      idempotency/dedup on Linear's webhook/event ID (a crashed devpod will redeliver).
- [ ] How Cyrus is best run for the spike (npm global `cyrus-ai` vs. from source) and
      what minimal `config.json` makes it boot without a real repo/token.

## References

- Cyrus repo: <https://github.com/cyrusagents/cyrus>
- Cyrus self-hosting guide (webhook routes — `/linear-webhook`, `/github-webhook`, `/callback`): <https://github.com/cyrusagents/cyrus/blob/main/docs/SELF_HOSTING.md>
- Cyrus docs: <https://www.atcyrus.com/docs/introduction>
- Linear webhooks (payloads + signature): <https://linear.app/developers/webhooks>
