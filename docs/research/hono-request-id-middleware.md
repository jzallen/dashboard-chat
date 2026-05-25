# Hono `requestId()` middleware for centralized request-id minting in ui-state

**Wave:** RESEARCH (CROSS_WAVE) · **Agent:** Nova (nw-researcher)
**Date:** 2026-05-25 · **Status:** Findings — implementation is a separate follow-up wave (see §9)
**Scope:** READ-ONLY investigation. No application/router code was modified by this wave.

---

## 1. Headline answer

**Yes.** Hono ships a first-party `requestId()` middleware (`hono/request-id`) that
does exactly what ui-state hand-rolls in ~10 places: **honor an inbound header if
present, mint a fresh id if absent**, and expose the value to every downstream
handler via `c.get('requestId')` / `c.var.requestId`. It is **configurable on all
three axes we need** — header name, generator function, and length limit.

It is available in the version this repo uses. `ui-state/package.json` declares
`"hono": "^4.7.0"` and the lockfile resolves to **`4.12.9`**; the middleware was
introduced in **Hono v4.5.0** (2024-07-16). The semver **floor** of our range
(`4.7.0`) already includes it, so no dependency bump is required under any
resolution permitted by the current range.

**Recommendation (detail in §8):** adopt `requestId()` at the composition root with
`headerName: 'X-Correlation-Id'` and a custom `generator` that mirrors the existing
`cryptoRandomId()`. Keep the persisted/projection field named `correlation_id` for
now (a rename is a larger, contract-touching change — §7). Sequence the change
**after** the concurrent `flow_id`-derivation refactor lands to avoid router-file
conflicts.

---

## 2. The question

Today every ui-state route re-derives a per-request trace id with the same inline
expression:

```ts
const correlationId = c.req.header("X-Correlation-Id") ?? cryptoRandomId();
```

(and at `/begin` of the onboarding app: `?? generateReferenceCode()`). The id is
stamped onto each persisted event and surfaced in the projection envelope. It is a
**per-request** distributed-trace id (honor inbound header, mint if absent — graceful
degradation on browser refresh), not a flow-wide trace. Can Hono centralize this in
one `app.use(...)`?

---

## 3. Current state — the duplication being targeted

Two near-identical generators exist:

| Generator | Definition | Source |
|---|---|---|
| `generateReferenceCode()` | `crypto.randomUUID()` | `ui-state/index.ts:23-25` |
| `cryptoRandomId()` | `globalThis.crypto?.randomUUID?.() ?? \`corr-${Date.now()}\`` | `ui-state/lib/hexagonal-transport/flow-router.ts:54-56` |

They are the same UUID at runtime; the only difference is `cryptoRandomId()`'s
non-crypto fallback (`corr-<epoch-ms>`) for environments lacking `globalThis.crypto`.

**Inline mint sites** (the `?? <generator>()` expression), ten in total across five
files — the prompt's "~12" estimate, counted precisely:

| # | Location | Route(s) | Generator |
|---|---|---|---|
| 1 | `index.ts:96-100` (`router.use("*")`) | sets `referenceCode` for the onboarding app | `generateReferenceCode()` |
| 2 | `lib/hexagonal-transport/flow-router.ts:76-77` | `/freeze` + `/thaw` (one factory, two routes) | `cryptoRandomId()` |
| 3 | `lib/machines/session-onboarding/router.ts:243-244` | `/event` | `cryptoRandomId()` |
| 4 | `lib/machines/session-onboarding/router.ts:360-361` | `/open-deep-link` | `cryptoRandomId()` |
| 5 | `lib/machines/project-context/router.ts:99-100` | `/begin` | `cryptoRandomId()` |
| 6 | `lib/machines/project-context/router.ts:159-160` | `/event` | `cryptoRandomId()` |
| 7 | `lib/machines/project-context/router.ts:233-234` | `/open-deep-link` | `cryptoRandomId()` |
| 8 | `lib/machines/session-chat/router.ts:79-80` | `/begin` | `cryptoRandomId()` |
| 9 | `lib/machines/session-chat/router.ts:111-112` | `/event` | `cryptoRandomId()` |
| 10 | `lib/machines/session-chat/router.ts:181-182` | `/open-deep-link` | `cryptoRandomId()` |

Downstream consumers of the value (must keep working after centralization):

- **Persistence:** stamped onto each Redis stream event as the `correlation_id`
  field — `ui-state/lib/persistence/redis.ts:48-49` (serialize) / `:62` (deserialize).
- **Projection envelope:** surfaced as `correlation_id`, taken from the last applied
  event — `ui-state/lib/projection.ts:985,992,1031`. This envelope is part of the
  ADR-027 §1 FE projection contract.
- **Failure simulation:** threaded as the `correlationId` argument into
  `shouldInject(...)` — e.g. `flow-router.ts:94`, `project-context/router.ts:137,185,202`,
  `session-chat/router.ts:137,154`, `session-onboarding/router.ts:297`.
- **Orchestrator command input:** carried as `correlation_id` on `send`/`begin`
  inputs (`orchestrator.ts:328`, `session-onboarding/strategy.ts:261`).

**Already a precedent:** `index.ts:96-108` *already* centralizes the onboarding app's
id via a `router.use("*")` middleware that sets `referenceCode`. The pattern this
research recommends is therefore not novel here — it generalizes an approach already
in the file, and replaces the hand-rolled middleware with the framework one.

> **Latent inconsistency worth noting.** Within the onboarding app, `/begin` uses the
> middleware-set `referenceCode` (`router.ts:228`) while `/event` and
> `/open-deep-link` mint a *separate* `correlationId` inline (sites #3, #4). When the
> inbound `X-Correlation-Id` header is **absent**, those two paths generate
> **different** random UUIDs for the same browser session. A single centralized
> middleware would make them identical — arguably a fix, but a behavior change to be
> aware of (§7).

---

## 4. Hono capability — confirmed against the in-repo version

### 4.1 Existence and version

- **Introduced:** Hono **v4.5.0**, released **2024-07-16** — release notes:
  *"Introducing Request ID Middleware. This middleware generates a unique ID for each
  request, which you can use in your handlers."* (PR [#3082](https://github.com/honojs/hono/pull/3082),
  by [@ryuapp](https://github.com/ryuapp)). [S4]
- **In this repo:** `ui-state/package.json:14` → `"hono": "^4.7.0"`; `package-lock.json`
  → resolved `hono@4.12.9`. [S1][S2] Both the resolved version **and** the range floor
  (`4.7.0`) post-date 4.5.0, so the middleware is present without any upgrade.

### 4.2 How to apply and read

```ts
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'

const app = new Hono()
app.use('*', requestId())

app.get('/', (c) => c.text(`Your request id is ${c.get('requestId')}`))
```

The value is read via `c.get('requestId')` (or `c.var.requestId`). For type safety,
import `RequestIdVariables` and pass it into the Hono generics so `c.get('requestId')`
is typed. [S3][S5]

### 4.3 Configuration — the three axes we care about

The middleware accepts `RequestIdOptions`: [S3][S5]

```ts
export type RequestIdOptions = {
  limitLength?: number              // default 255
  headerName?: string               // default 'X-Request-Id'; '' disables custom-header honoring
  generator?: (c: Context) => string // default () => crypto.randomUUID()
}
```

- **Header name — configurable.** Default is `X-Request-Id`. We can set
  `headerName: 'X-Correlation-Id'` to match our ingress contract verbatim. Setting it
  to `''` disables inbound-header honoring entirely (not what we want). [S3][S5]
- **Honor-if-present / mint-if-absent — built in and exactly our behavior.** The docs
  state: *"By default, the middleware checks for an existing ID in the `X-Request-Id`
  header and will use that value if present."* [S3] The source confirms the precise
  rule: [S5]

  ```ts
  // hono/src/middleware/request-id/request-id.ts (main)
  let reqId = headerName ? c.req.header(headerName) : undefined
  if (!reqId || reqId.length > limitLength || /[^\w\-=]/.test(reqId)) {
    reqId = generator(c)
  }
  ```

  i.e. the inbound header is honored **only if** it exists, is within `limitLength`,
  and contains only `[A-Za-z0-9_\-=]`; otherwise a fresh id is generated. This is a
  *stricter* version of our current `?? cryptoRandomId()` (which honors any non-null
  header value unconditionally — see §7 caveat).
- **Generator — customizable.** Pass `generator: (c) => ...` to reproduce
  `cryptoRandomId()` (including its `corr-${Date.now()}` fallback) exactly. [S3][S5]
- **Also writes the response header.** The middleware echoes the id back onto the
  response: `if (headerName) { c.header(headerName, reqId) }`. [S5] This is **new
  behavior** vs. our current code (which never sets a response header) — see §7.

---

## 5. Before / after sketch

### Before (current — repeated at all ten sites)

```ts
// e.g. project-context/router.ts:159-160 and nine sibling sites
const correlation_id = c.req.header("X-Correlation-Id") ?? cryptoRandomId();
// ...
await orchestrator.send({ /* ... */ correlation_id });
```

### After (one registration at the composition root, read everywhere)

```ts
// ui-state/index.ts (or buildSessionOnboardingApp) — registered ONCE
import { requestId, type RequestIdVariables } from "hono/request-id";

app.use("*", requestId({
  headerName: "X-Correlation-Id",                 // honor our ingress header
  generator: () =>                                 // parity with cryptoRandomId()
    globalThis.crypto?.randomUUID?.() ?? `corr-${Date.now()}`,
}));
```

```ts
// every handler — no inline mint, just read the centralized value
const correlation_id = c.get("requestId");
await orchestrator.send({ /* ... */ correlation_id });
```

```ts
// typing the context (per machine router's Env / SessionOnboardingRouterContext)
type Vars = RequestIdVariables & { /* existing referenceCode, userId, ... */ };
new Hono<{ Variables: Vars }>();
```

This deletes both generators' call sites (10 inline expressions) in favor of one
`app.use(...)`, and lets the `freezeThawHandler` / machine routers drop their
`cryptoRandomId` import.

---

## 6. Interaction & migration analysis

### 6.1 Does one generator suffice? (the `/begin` gap)

Yes. `generateReferenceCode()` (`crypto.randomUUID()`) and `cryptoRandomId()`
(`crypto.randomUUID()` **with** a `corr-<epoch-ms>` fallback) produce the same value
on any runtime that has `globalThis.crypto` — which Node 20+ does (the repo targets
`@types/node@^25`, and `flow-router.ts:53` notes `randomUUID` is "in Node 19+"). A
single custom `generator` that includes the fallback reproduces **both** exactly.
If the default generator is used instead, the only thing lost is the
`corr-${Date.now()}` fallback for crypto-less runtimes — acceptable in practice, but a
deliberate choice to record.

### 6.2 `referenceCode` vs `correlationId` — two names, one runtime value

The onboarding app threads the id under the name **`referenceCode`** (described as
"the support-facing trace handle a flow surfaces to the user" — `index.ts:18-25`),
while every other route calls it **`correlationId`**. Both are derived from the same
`X-Correlation-Id` inbound header, so at runtime they are the **same id** whenever the
header is present. Centralizing collapses them to a single source (and removes the
absent-header divergence noted in §3). The `referenceCode` *name* can remain a local
alias of `c.get('requestId')` if the support-facing vocabulary is worth keeping.

### 6.3 The naming question — `correlation_id` vs `request_id`/`trace_id` (trade-off, not a decision)

The field is named `correlation_id` but behaves like a **per-request** id, not a
flow-wide correlation. Two ways to reconcile:

**Option A — Centralize, keep the `correlation_id` field name (lowest risk).**
Register `requestId({ headerName: 'X-Correlation-Id', generator })`, then read
`c.get('requestId')` into the existing `correlation_id` variable at each call site.
- ✅ Zero change to persisted bytes (Redis `correlation_id` field), the ADR-027
  projection envelope, `shouldInject`'s `correlationId` arg, or orchestrator inputs.
- ✅ No coordination with the `X-Correlation-Id` header producer (auth-proxy / FE).
- ⚠️ Mild vocabulary mismatch: the Hono context var is fixed at `requestId` while the
  domain field stays `correlation_id`.

**Option B — Rename to `request_id` / `trace_id` (cleaner, larger blast radius).**
Align the domain field, and optionally move the ingress header to Hono's default
`X-Request-Id`.
- ✅ Name matches the actual semantics and the framework vocabulary.
- ❌ The field is **persisted** into the Redis event log (`redis.ts:48`) — a rename
  changes stored bytes and needs a migration or dual-read/back-compat window.
- ❌ The projection envelope `correlation_id` is part of the **ADR-027 FE contract** —
  renaming is a breaking API change requiring a coordinated frontend update.
- ❌ Changing the ingress header from `X-Correlation-Id` to `X-Request-Id` requires
  coordinating whoever sets it upstream (auth-proxy, the browser client).

These are not mutually exclusive in time: **A now, B later** as its own scoped
migration. This wave does **not** decide between them — it surfaces the trade-off for
the team.

---

## 7. Risks & caveats

1. **Inbound-header validation is stricter than today.** The middleware regenerates
   when the inbound value exceeds `limitLength` (255) **or** contains a character
   outside `[A-Za-z0-9_\-=]` (`/[^\w\-=]/`). [S5] Our current `?? cryptoRandomId()`
   honors *any* non-null header value. UUIDs (hex + hyphens) and the `corr-<ms>`
   fallback both pass, so honest traffic is unaffected — but a previously-honored
   weird/oversized inbound id would now be silently replaced. Verify no upstream sends
   non-`[\w\-=]` correlation ids before switching.
2. **New response header.** The middleware sets `c.header(headerName, reqId)` on the
   response. [S5] Today no route emits an `X-Correlation-Id` response header; after
   adoption every route would. Generally harmless (often desirable for tracing), but
   it is an observable wire change — confirm the reverse-proxy / FE don't choke on it.
3. **Routes returning a raw `Response`.** `GET /projection/stream` builds its own
   `new Response(stream, { headers, status: 200 })` (`flow-router.ts:225`) rather than
   using `c.json`. A middleware-set `c.header(...)` may not propagate onto a
   hand-constructed `Response`. The **context value** `c.get('requestId')` is still
   available to the handler regardless; only the *response-header echo* is in question.
   Low impact (the SSE routes don't currently mint or persist a correlation id — the
   projection's `correlation_id` comes from the last persisted event,
   `projection.ts:992`), but worth a confirmation test.
4. **Middleware ordering.** `requestId()` must run before any handler reads
   `c.get('requestId')` and before `shouldInject(...)` calls that consume the id.
   Registering it as the first `app.use('*', ...)` at the composition root (alongside
   the existing `router.use("*")` that sets `referenceCode`, `userId`, etc.) satisfies
   this. Each machine router is a separately-constructed `new Hono()`
   (`project-context/router.ts:96`, `session-chat/router.ts:76`) mounted under the
   root — ensure the middleware is applied on the app that actually serves them (the
   mounted parent), or registered per sub-app.
5. **Persistence/projection compatibility (Option A).** Because Option A keeps the
   `correlation_id` field name and value semantics, Redis bytes and the projection
   envelope are unchanged — no migration. This is the reason A is low-risk; it is only
   Option B that incurs persistence/contract cost.
6. **Failure-simulation parity.** The `shouldInject({ correlationId })` calls must read
   `c.get('requestId')` instead of the local `correlation_id`. Pure rename of the
   source expression; the audit envelope value is unchanged when the inbound header is
   present (and a single consistent value when absent).

---

## 8. Recommendation

**Adopt `requestId()` — Option A (centralize without renaming the domain field).**

1. Register once at the composition root:
   `app.use('*', requestId({ headerName: 'X-Correlation-Id', generator }))`, where
   `generator` mirrors `cryptoRandomId()` (UUID + `corr-<ms>` fallback) for exact
   parity.
2. Replace the ten inline `?? cryptoRandomId()/generateReferenceCode()` expressions
   with `c.get('requestId')`; delete `cryptoRandomId` / `generateReferenceCode` and
   their imports.
3. Add `RequestIdVariables` to each router's `Variables` generic for type safety.
4. Keep `correlation_id` as the persisted/projection/`shouldInject` field name. Treat
   a `request_id`/`trace_id` rename (Option B) as a **separate, later** migration
   because it touches the Redis format, the ADR-027 projection contract, and the
   ingress header producer.

**Why:** Option A captures essentially all the value (one source of truth, DRY, fewer
imports, a fix for the absent-header divergence) at near-zero risk, using a
first-party middleware already present in the pinned version. The two behavior changes
it introduces (stricter inbound validation; a response-header echo) are minor and
testable.

---

## 9. Sequencing — implementation is a separate wave

- **Do not implement in this RESEARCH wave.** This document is the deliverable.
- A concurrent **`flow_id`-derivation refactor is editing the same router files**
  (`index.ts`, `flow-router.ts`, and the three machine `router.ts` files). To avoid
  conflicts, the request-id centralization should be scheduled **after** that refactor
  lands on `main`.
- Suggested follow-up entry point: a DELIVER-wave change (the mechanism is understood
  and low-risk), or DISTILL first if the team wants a regression test pinning
  honor-if-present / mint-if-absent before the swap.

---

## 10. Sources

Primary sources (Hono official docs + repo) preferred; ≥2 sources per load-bearing
claim. Access date **2026-05-25**.

| ID | Source | Type | Reputation | Used for |
|---|---|---|---|---|
| S1 | `ui-state/package.json:14` (this repo) | Primary (code) | High | Declared Hono range `^4.7.0` |
| S2 | `package-lock.json` → `node_modules/hono` `4.12.9` (this repo) | Primary (code) | High | Resolved Hono version |
| S3 | Hono docs — Request ID Middleware, https://hono.dev/docs/middleware/builtin/request-id (via Context7 `/websites/hono_dev`) | Primary (official docs) | High | API, options (`headerName`/`generator`/`limitLength`), honor-if-present, `c.get('requestId')`, `RequestIdVariables` |
| S4 | Hono v4.5.0 release notes, https://github.com/honojs/hono/releases/tag/v4.5.0 | Primary (official release) | High | Introduction version + date (2024-07-16), PR #3082 |
| S5 | Hono source, https://github.com/honojs/hono/blob/main/src/middleware/request-id/request-id.ts | Primary (official repo) | High | Exact honor/discard rule, defaults, response-header echo, `RequestIdOptions`/`RequestIdVariables` types |
| S6 | Hono v4.6.0 release notes, https://github.com/honojs/hono/releases/tag/v4.6.0 | Primary (official release) | High | Cross-check: requestId NOT a 4.6.0 feature (corroborates 4.5.0 origin) |

**Cross-reference status:** the load-bearing claims — *the middleware exists*, *it
honors-if-present/mints-if-absent*, *header name and generator are configurable*, and
*it is in our version* — are each supported by ≥2 primary sources (hono.dev docs +
GitHub source/release + in-repo manifest/lockfile). Confidence: **high**.
