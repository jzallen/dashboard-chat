# Slice 06 — ui SSR/BFF gap closure + server LOG_LEVEL

**Story:** US-6 · **Sub-job:** SJ-6 · **Surface:** ui · **Effort:** ~0.5 day

## Goal (one sentence)
Close the remaining logging gaps on the otherwise best-in-class ui surface: log the SSR/BFF gateway relays and loader failures through the structured logger, and give the SSR server runtime `LOG_LEVEL` control.

## IN scope
- Log `/bff/*` relays (`routes/bff-chat.tsx`, `routes/bff-health.tsx`): upstream status + failures, with request path + correlation id.
- Log SSR loader/action failures (path/method/status) through `createLogger`.
- Replace the bare `console.error` in `entry.server.tsx:49` with `createLogger(...).error(...)`.
- Give the ui **server** context `LOG_LEVEL` control (fix `configuredLevel()` reading only `localStorage`); keep the browser `ui:log` knobs.
- Inject the correlation id on the `/bff/*` and `/api/*` hops (`proxy-fetch.ts` `withForwardedCredential()`).

## OUT scope
- Client-side chat fetch/SSE error logging (covered in Slice 05).
- Any change to the existing `ui/app/lib/log.ts` envelope (it is the standard; only its level-resolution is extended for the server).

## Learning hypothesis
**Disproves** that the SSR server can honour `LOG_LEVEL` **without** leaking debug logs to the browser console in production. If the shared logger module can't cleanly distinguish server vs browser level resolution, the logger needs a server/client split.
**Confirms** (if it succeeds) that one logger module serves both runtimes with correct, separate level control.

## Acceptance criteria
- AC1: `/bff/*` relays log upstream status + failures server-side with request path + correlation id.
- AC2: SSR loader/action failures log path/method/status through the structured logger.
- AC3: `entry.server.tsx` render errors use `createLogger`, not bare `console.error`.
- AC4: The ui server honours `LOG_LEVEL`; no new logs reach the browser console in production; the correlation id is injected on the `/bff/*` + `/api/*` hops.

## Dependencies
Uses the correlation id (Slice 02). Smallest slice — `ui/` already has the logger; this is gap-filling + a server/client level-resolution fix.

## Pre-slice SPIKE
Not required.

## Reference class
Gap-filling within an existing structured-logging setup (`ui/app/lib/log.ts`); the only non-trivial bit is server-vs-browser `LOG_LEVEL` resolution in a shared module under RRv7 framework mode.
