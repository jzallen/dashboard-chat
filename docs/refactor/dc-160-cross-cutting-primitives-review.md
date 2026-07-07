# Design review — Cross-cutting primitives & substrates (DC-160)

Part of the DC-151 UI Design Review. These primitives are consumed by **every**
user flow (Onboarding, Workspace/Lineage, Detail, Upload, Chat), so they get a
dedicated review rather than being folded into any one flow.

**Scope reviewed** — four substrate areas under `ui/app/`:

1. **StateProxy client-actor layer** — `lib/state-proxy.ts`, `lib/StateProxyProvider.tsx`, `lib/proxy-fetch.ts`
2. **Server request hop** — `lib/api-client.ts`, `lib/ui-server-client.ts`, `catalog/dataSources/backendClient.ts`, `routes/ui-server/*`
3. **Theme & design-system primitives** — `components/AppShell/ThemeProvider.tsx`, `components/primitives.tsx`, `components/Tweaks/*`, `components/LoadingSurface/LoadingSurface.tsx`, `components/AppShell/Overlays.tsx`
4. **Logging** — `lib/log.ts`

**Evaluation axes** — readability; cohesion (coupling & connascence); state–presentation
segregation; use of common React idioms.

**Method** — the review was produced by dispatching the nwave code-quality reviewer
agent (`nw-software-crafter-reviewer`) over the four areas, then reconciling every
finding against the source so each carries verified `file:line` evidence. This is a
**review only** — no production code was modified.

---

## Verdict

The substrate layer is **fundamentally well-built**: transport is injected and
unit-testable, credential forwarding is centralised in one primitive, the icon index
is exhaustively typed, and the SSE cache ordering is subtle but correct. The weaknesses
are concentrated in three places:

- **State–presentation cohesion** — the theme `dark` boolean forks whole component
  *identities* (`Overlays.tsx`) rather than driving CSS, and one branch is a scripted
  demo (cross-referenced from the DC-159 Chat review).
- **Observability** — the logger carries no correlation/flow/request ID, so a single
  user action cannot be traced across the StateProxy → broker → backend hops even
  though all three log through the same channel.
- **Dead weight & bundled concerns** — ~28 KB of parked `Tweaks` code ships unmounted,
  and `primitives.tsx` fuses three unrelated concerns under one "primitives" umbrella.

None of these are correctness bugs; they are design debt that compounds as more flows
consume these substrates.

---

## Highest-impact findings

| Sev | Finding | Axis | Location |
|---|---|---|---|
| **Critical** | `dark` boolean forks the **whole component tree** (`TerminalAssistant` vs `AssistantOverlay`) instead of CSS-theming — a runtime toggle swaps component identity and destroys internal state; one branch is a scripted demo | State–presentation | `Overlays.tsx:71-87` |
| **Critical** | Logger record carries **no correlation/flow/request ID** — StateProxy bootstrap, broker hop, and chat stream all log through `createLogger` but cannot be stitched into one user action | Cohesion / observability | `log.ts:71-84` |
| **Major** | ~28 KB **parked, unmounted** `Tweaks` toolkit ships in the tree — imported by nothing outside `components/Tweaks/` | Cohesion (dead code) | `components/Tweaks/*` |
| **Major** | `primitives.tsx` bundles **three unrelated concerns** — icon registry, `LayerDot`/`LayerBadge`, and the `SqlBlock` SQL highlighter — under one file | Cohesion | `primitives.tsx:1-229` |
| **Major** | JSON:API envelope-unwrap lives in **`backendClient`, not the broker** — the server-side hop passes the raw envelope through, so the unwrap concern is split across two layers | Cohesion (connascence of meaning) | `backendClient.ts:47-58,88-94` vs `ui-server-client.ts:31-49` |
| **Minor** | `brokerGet` / `brokerPatch` / `brokerPost` are **algorithmically identical** bar method/path/body — connascence of algorithm across three ~40-line bodies | Cohesion | `ui-server-client.ts:31-135` |

---

## Kept as good (preserve as-is)

These are correct and deliberate — do **not** "refactor" them away:

- **Injected transport ports** (`fetchImpl` + `eventSourceFactory`) make the StateProxy
  unit-testable with no network and no platform `EventSource` — `state-proxy.ts:65-74,129-135`.
- **`pushDocument` caches before it fans out** so a `getSnapshot` re-read from *inside*
  an observer (which `useSelector` does) sees the fresh value — `state-proxy.ts:152-157`.
- **One credential-forwarding primitive** (`withForwardedCredential` / `proxyFetch`)
  shared by the `/api` and `/worker` hops — no duplicated cookie-copy logic —
  `proxy-fetch.ts:35-47`, consumed at `api-client.ts:13,38`.
- **`redact()` on emit** scrubs credentials from every ECS JSON line before it reaches
  the console/sink — `log.ts:96`.
- **Exhaustive icon index** typed with `satisfies Record<string, LucideIcon>` and an
  exhaustive `TAG_ICON: Record<AuditTag, IconName>` — no runtime fallback needed —
  `primitives.tsx:89,98-110`.
- **`ApiError` carries `status` + `body`** so definitive HTTP answers (404/401/422) map
  cleanly to closed-union outcome causes for the onboarding driver — `backendClient.ts:27-36`.

---

## Findings by area

### Area 1 — StateProxy client-actor layer

| ID | Sev | Axis | Finding | Evidence | Connascence |
|---|---|---|---|---|---|
| **1.1** | Minor | Readability | `fetchDocument` throws a synthetic `Response(504)` on **transport timeout**, indistinguishable from a genuine upstream 504. Callers can't tell "gateway timed out" from "we aborted at 5 s". | `state-proxy.ts:118-120` | Type — a `Response` overloaded as both error signal and HTTP result |
| **1.2** | Minor | Readability | `ensureBootstrap` is a once-per-load latch gated on `hasSession()`; the "no-op-without-latching so a post-login call still bootstraps" contract is subtle and lives only in prose. Correct, but brittle to call-site discipline. | `StateProxyProvider.tsx:59-73` | Name — latch semantics implicit at call sites |
| **1.3** | Minor | Cohesion | Wire region/state names (`anonymousStateDocument`, `ChatAppStateDocument`) are shared via the `@dashboard-chat/ui-state-wire` SSOT — good — but the injected `seed` is not `satisfies`-checked, so a mismapped seed would fail silently rather than at compile time. | `state-proxy.ts:65-74,140` | Type — implicit contract on seed shape |
| **1.4** | — | — | **Good:** SSE `state`/`error` frame handling keeps the cache last-known-good on transport drop and only notifies (EventSource auto-reconnects and the server re-emits) — `state-proxy.ts:163-189`. | | |

**Note on the singleton (Area 1 focus).** The module-level `defaultProxy` shared-mutable
instance (`StateProxyProvider.tsx:41-46`) is the classic "module singleton" smell, but
here it is *intentional and contained*: it is injectable for tests (the `proxy` prop),
lazily created once, and there is genuinely one remote actor per app load. Flagged for
awareness, **not** for change — extracting it would add ceremony without removing risk.

### Area 2 — Server request hop

| ID | Sev | Axis | Finding | Evidence | Connascence |
|---|---|---|---|---|---|
| **2.1** | Major | Cohesion | JSON:API envelope-unwrap (`.data` → flatten `{type,id,attributes}`) lives **client-side in `backendClient`**, while the server-side brokers pass the upstream body through byte-intact. The "where does the envelope get unwrapped" answer differs by path — a split concern that callers must know about. | `backendClient.ts:47-58,88-94` vs `ui-server-client.ts:44-48` | Meaning — "response body" means wrapped on one path, flat on another |
| **2.2** | Minor | Cohesion | `brokerGet`/`brokerPatch`/`brokerPost` differ only in HTTP method, body carry, and the backend path; the response-shaping tail (`content-type` default + empty-2xx-→`{}`) is copy-pasted three times. | `ui-server-client.ts:31-135` | Algorithm — identical request/response shape across three bodies |
| **2.3** | Minor | Cohesion | The `if (!res.ok) { if 401 handleUnauthorized(); throw new ApiError(...) }` block repeats across `apiGet`/`apiPatch`/`apiPost`/`apiUpload`. | `backendClient.ts:78-85,120-127,152-159,181-188` | Algorithm — **team has accepted this as deliberate YAGNI**; noted, not actioned |
| **2.4** | Minor | Readability | Two parallel auth transports coexist: the server hop forwards `cookie`+`authorization` via `proxyFetch`; `backendClient` relies on browser `credentials:"include"` and carries a permanently-ignored `_token` seam. Both are *correct* for their runtime (server loader vs browser), but the split is undocumented at a shared level. | `api-client.ts:33-39` vs `backendClient.ts:65-77` | Type — `Request`-context forwarding vs browser cookie forwarding |

**Empty-body → `{}` assumption.** All three brokers default a body-less 2xx to `"{}"`
so a JSON-reading caller still parses (`ui-server-client.ts:44-45,87-88,130-131`). Safe
for today's callers, but it means a genuine `204 No Content` serialises as an empty
object rather than `null` — worth a one-line contract note if any flow later needs 204
semantics.

### Area 3 — Theme & design-system primitives

| ID | Sev | Axis | Finding | Evidence | Connascence |
|---|---|---|---|---|---|
| **3.1** | Critical | State–presentation | `dark` selects **which component renders** — `dark ? <TerminalAssistant/> : <AssistantOverlay/>` — rather than toggling a CSS class. Toggling the theme at runtime swaps component identity (remounts, loses state), and `TerminalAssistant` is a scripted demo per the DC-159 review. Theme is presentation; it must not fork behaviour. | `Overlays.tsx:71-87` | Type — `dark: boolean` → component selection |
| **3.2** | Major | Cohesion | `components/Tweaks/*` (`TweaksPanel.tsx` ~26 KB + `useTweaks` + `index`) is imported by **nothing** outside its own directory — confirmed parked/unmounted dead code shipping in the tree. `ThemeProvider`'s own comment calls it "the parked example". | `components/Tweaks/*` (grep: no external importers) | Meaning — "parked" = shipped but unreachable |
| **3.3** | Major | Cohesion | `primitives.tsx` fuses three unrelated concerns: the icon registry + `Icon`, the `LayerDot`/`LayerBadge` catalog primitives, and the `SqlBlock` SQL highlighter. "primitives" is an umbrella, not a cohesive module. | `primitives.tsx:51-124,128-150,198-225` | Name — grab-bag module name |
| **3.4** | Minor | Readability | Single-theme assumption is hard-coded: `rootClassName: "app theme-neobrutalist" + (dark ? " dark" : "")`. Fine for v1, but the theme name is a string literal with no seam for a second theme. | `ThemeProvider.tsx:49` | Name — implicit single theme |
| **3.5** | Minor | Coupling | `LoadingSurface` reaches up to `useTheme().rootClassName` and re-applies it because it renders *outside* the app-shell's themed wrapper. Correct, but it depends on the exact `.app theme-*` class format — a silent break if `ThemeProvider` changes that string. | `LoadingSurface.tsx:17-19` | Execution — depends on ThemeProvider's class-name shape |
| **3.6** | Minor | Readability | `query-engines.tsx` (and peers) use heavy inline `style={{}}` (padding, font-size, colour tokens) instead of a CSS module — harder to override via design tokens. Low priority (stub route). | `query-engines.tsx:4,5,8` | Type — inline styles vs CSS module |
| **3.7** | — | Security | **Good (with a caveat):** `SqlBlock` uses `dangerouslySetInnerHTML`, but escapes HTML **first** in the transform pipeline, so injected `<span>`s are safe; input is backend-sourced catalog SQL (trusted). Add a one-line contract note that user-controlled SQL is not accepted here. | `primitives.tsx:198-225` | |

### Area 4 — Logging

| ID | Sev | Axis | Finding | Evidence | Connascence |
|---|---|---|---|---|---|
| **4.1** | Critical | Cohesion / observability | `LogRecord` carries `@timestamp`, `log.level`, `event.module`, `event.action`, `attributes` — but **no `trace_id`/`correlation_id`/`request_id`**. Every cross-cutting flow (StateProxy `session_begin`, the broker hop, the onboarding/upload drivers) logs through the same `createLogger`, yet the records cannot be correlated into a single user action. Confirmed: no correlation field anywhere in `log.ts`. | `log.ts:71-84` (grep for trace/correlation/request id → none) | Execution — independent loggers, no shared context |
| **4.2** | Minor | Cohesion | Records conform to ECS/OTel but the only backend is consola→console; there is no sink wiring. This is fine (the shape is *portable*), but the "ever shipped to a log sink" promise in the header has no mechanism behind it yet. | `log.ts:1-17,103-107` | Type — portable shape without a transport |
| **4.3** | — | — | **Good:** verbosity resolution (`ui:log` localStorage → `LOG_LEVEL` env → INFO) is SSR-tolerant and `redact()` runs on every JSON line. | `log.ts:47-68,93-101` | |

---

## Prioritized refactor backlog

### Tier 1 — should-fix (cohesion/observability blockers)

1. **De-fork the theme in `Overlays`** (F3.1) — render one assistant component and let
   CSS handle dark; delete `TerminalAssistant` if it stays a demo (coordinate with the
   DC-159 outcome). Removes the "theme swaps component identity" hazard.
2. **Add a correlation ID to the logging substrate** (F4.1) — generate one ID per user
   action (React context at the RRv7 boundary), thread it into `createLogger`/record
   attributes, and have the drivers + StateProxy include it. Unlocks flow-level tracing
   across the StateProxy → broker → backend hops.
3. **Archive or delete the `Tweaks` toolkit** (F3.2) — remove ~28 KB of unmounted code
   from the shipped tree, or move it under `docs/examples/` / behind a feature flag if
   design controls are genuinely scheduled.

### Tier 2 — should-improve (readability/cohesion)

4. **Clarify the JSON:API unwrap boundary** (F2.1) — decide whether the *broker* owns the
   envelope→flat transform (recommended: it owns the SPA-facing shape) or the client
   does, and make it consistent. Removes the split-concern ambiguity.
5. **Split `primitives.tsx`** (F3.3) — `Icon/`, `LayerBadge/`, `SqlBlock/` as focused
   modules behind a barrel export for back-compat.
6. **Extract a generic broker** (F2.2) — one `brokerProxy(request, path, method, body?)`
   collapsing the three near-identical bodies (respecting the accepted-duplication note
   for the `backendClient` 401 block, which is *separate*).
7. **Document the coupling contracts** (F3.5, F3.7, F2.4) — `LoadingSurface`↔`ThemeProvider`
   class-name dependency; `SqlBlock` trusted-input contract; the two auth transports.

### Tier 3 — nice-to-have

8. **`FetchTimeoutError`** instead of a synthetic `Response(504)` (F1.1).
9. **`seed satisfies ChatAppStateDocument`** assertion in `createStateProxy` (F1.3).
10. **Move `query-engines.tsx` inline styles to a CSS module** (F3.6).
11. **Wire an ECS log sink reporter** when observability tooling lands (F4.2); parameterise
    the single theme string in `ThemeProvider` when a second theme is needed (F3.4).

---

## Connascence summary

| Type | Where | Strength | Disposition |
|---|---|---|---|
| Type (dark → component) | `Overlays.tsx:71-87` | Strong, dynamic | **Fix** — CSS, not component fork |
| Execution (no correlation id) | `log.ts:71-84` | Strong, cross-module | **Fix** — inject shared context |
| Meaning (envelope unwrap split) | `backendClient` vs broker | Medium, cross-module | Clarify boundary |
| Name ("primitives" grab-bag) | `primitives.tsx` | Medium, local | Split module |
| Algorithm (broker triplet) | `ui-server-client.ts` | Medium, local | Extract generic |
| Algorithm (401 block ×4) | `backendClient.ts` | Medium, local | **Accepted YAGNI** — leave |
| Execution (LoadingSurface↔theme class) | `LoadingSurface.tsx:17` | Weak, local | Document |
| Type (Response-as-error) | `state-proxy.ts:118` | Weak, local | Optional custom error |

---

_Review artifact for DC-160. No production code changed._
