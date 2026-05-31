# Walking Skeleton — pipeline-layers-ui-redesign / MR-4

> Notes only. The scenario SSOT is the vitest suite
> `frontend/src/ui/components/Assistant/Assistant.test.tsx` (+ `app/routes/home.test.tsx`,
> and the re-spec edits to `AppShell.test.tsx` / `Breadcrumb.test.tsx`). happy-dom is
> the medium (DWD-M4-2): assert structure / testids / navigation, never computed colors.

## Strategy
**C — real local I/O, frontend-only** (DWD-M4-1). No backend / external / costly deps.
The gate is `cd frontend && npx vitest run`. No pytest acceptance suite (none exists
for this feature; mirrors MR-1/2/3).

## The thin slice (`@walking_skeleton`)
`Assistant.test > "shows the streamed messages and the chat input inside the overlay"`:
a real FAB click → the real overlay renders → the **existing** chat context (doubled at
the `useChatContext` boundary) is surfaced through the **real** `MessageList` +
`ChatInput`. This proves the load-bearing MR-4 premise end-to-end: the assistant is a
pure presentation reshell over the existing chat plumbing (DWD-M4-3) — open the FAB,
see the real feed, type into the real input, ui-state wire untouched.

## Driving port (FE analog)
The rendered route surface via `createRoutesStub`. There is no CLI/HTTP/hook entry
point in the frontend; the user's actual invocation path is the FAB + overlay +
index redirect, exercised at real paths (`/`, `/?org=1`) with real navigation
destinations (`/sessions`, `/chat/:channelId`, `/projects/:projectId/pipeline`,
`/projects`). Navigation is asserted by destination render, not a spy (DWD-M4-9).

## Scenario inventory (13 MR-4 cases)
**`Assistant.test.tsx` (8)** — FAB renders + no overlay until opened · FAB opens glass
overlay then closes · overlay renders the chat feed (messages + `chat-input`) from
context · New Session resets the session · history navigates to `/sessions` · recent
chips from `useSessions` deep-link to `/chat/:id` · dark root class → terminal (not
glass) · light → glass (not terminal).
**`home.test.tsx` (3)** — projects present → redirect to first project's pipeline ·
zero projects → redirect to `/projects` (never strand) · loading (null) → resolving
placeholder.
**`AppShell.test.tsx` (re-spec, +1)** — shell mounts `<Assistant>` as a sibling of the
Outlet.
**`Breadcrumb.test.tsx` (re-spec, +1)** — utility menu no longer exposes New Session /
All Chats (moved to the assistant); Query Engines stays reachable.

## What the doubles CANNOT model
- happy-dom does not apply the token stylesheet → no glass/halftone/Solarized contrast
  assertions (MR-8 Playwright pass).
- the doubled `useChatContext` / `useSessions` ports do not model real SSE streaming
  latency or network errors (covered by the existing chat/stream tests; out of scope
  for a presentation reshell).
- `useIsDark`'s `MutationObserver` reactivity to a live toggle is exercised structurally
  via the applied root class set per test, not via a real `ThemeToggle` click (the
  toggle is MR-3's, unit-tested there).
