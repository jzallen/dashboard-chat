# Design Review — Chat / Assistant Flow (DC-159)

Part of the DC-151 UI Design Review, sliced by core user flow. Evaluates the
Chat/Assistant flow's React code for **readability**, **cohesion (coupling &
connascence)**, **state-presentation segregation**, and **use of common React
idioms**. This is a *review* — it recommends directions and spawns follow-up
refactor tickets; it does not change code.

**Flow:** open the assistant dock in the context of a model, stream the agent
reply over SSE, watch tool-action cards mutate the lineage in real time, and
browse/reopen past chat sessions.

**Files reviewed**

- `ui/app/routes/chats.tsx`, `ui/app/components/Chat/Chat.tsx`, `ui/app/components/ChatSessionList/ChatSessionList.tsx`
- `ui/app/lib/chatContext.tsx`, `ui/app/lib/agent-client.ts`, `ui/app/lib/chat-stream.ts`
- `ui/app/routes/ui-server/chat.tsx` (SSE relay)
- `ui/app/components/AppShell/Overlays.tsx` (theme→variant selection)
- `ui/app/components/Chat/Chat.test.tsx`, `ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx`

---

## Verdict

The flow is **architecturally sound at the transport seam** — the un-buffered
SSE relay (`routes/ui-server/chat.tsx`) and the standalone frame reader
(`lib/chat-stream.ts`) are clean, testable, and correctly separated. The
weakness is concentrated in the **566-line `Chat.tsx` component module**, which
fuses business logic (SSE turn orchestration, catalog-revalidation decisions,
context inference, markdown rendering) with presentation across two
near-duplicate variants — one of which (`TerminalAssistant`) is still a scripted
`setTimeout` demo on a theme-selected production path. The single most important
gap is a **missing cancellation/cleanup boundary** on the streaming turn:
there is no `AbortController` and no unmount guard, so closing the dock mid-turn
leaks the stream and fires `setState` on an unmounted component. Production-
capable once the Tier-1 items land; fragile without them.

---

## Findings

### 1. Readability

- **[Major] Two variants whose names don't signal they are theme-selected siblings**
  — `Chat.tsx:78` (`AssistantOverlay`) / `Chat.tsx:333` (`TerminalAssistant`).
  They share `ChatDockProps` and most logic, but the pairing (light→overlay,
  dark→terminal) is only discoverable in `Overlays.tsx:70-87`, three files away.
  A reader can't tell from the module which one to touch or why two exist.
  *Direction:* rename to signal the theme role (e.g. `LightChatAssistant` /
  `DarkChatAssistant`) or collapse into one component with a `variant` prop, and
  co-locate the selection with the Chat module.

- **[Minor] Silent first-match precedence in `agentContext()`** — `Chat.tsx:52-66`.
  `ref.fields → dataset`, else `ref.columns → view`, else `ref.columns_metadata
  → report`. The precedence when a ref carries more than one key is implicit and
  undocumented. **Connascence of algorithm** (moderate), and connascence of
  position on the probe order. *Direction:* document the "exactly one populated"
  invariant, or lift the discrimination to a typed guard/schema the backend
  already vets.

- **[Minor] Hardcoded domain-event set reads as a literal, not a contract** —
  `chat-stream.ts:39-46`. See §2 for the connascence dimension; as a readability
  matter the file's own comment flags the shared-schema adoption as deferred.

### 2. Cohesion — coupling & connascence

- **[Critical] SSE lifecycle is render-scoped with no cancellation or unmount guard**
  — `Chat.tsx:110-162`. `runScript()` awaits `readChatStream()` with inline
  `setMsgs`/`setTyping` closures and no `AbortController`. If the dock unmounts
  mid-turn (user hits Close — `closeWith` runs on a 200 ms timer, `Overlays`
  drops the component on `chatOpen=false`), the fetch/reader keep running and the
  handlers call `setState` on an unmounted component; the buried
  `catalog.revalidateScope()` (`Chat.tsx:71-76`) can still fire against a torn-down
  tree. Long turns (tens of seconds) make this a real leak, not a theoretical one.
  The scroll effect (`Chat.tsx:99-102`) also has no cleanup. *Direction:* own the
  turn in a `useChatTurn()` hook that creates an `AbortController`, passes its
  signal to `fetch`, and aborts on unmount; gate late handler callbacks on a
  mounted ref.

- **[Major] Demo mock on a theme-selected production path** — `Chat.tsx:364-396`.
  `TerminalAssistant.runScript()` never makes a network call: it `sleep()`s
  (`Chat.tsx:47`, 370/375/379) and replays `catalog.getChatScript()` turns. Because
  the variant is chosen purely by dark theme (`Overlays.tsx:71`), dark-mode users
  get a scripted experience with no live agent, no indicator, and no error. The
  live-path comment at `Chat.tsx:109` acknowledges the split. *Direction:* wire
  the terminal variant to the same real turn (shared hook), or quarantine the
  replay behind an explicit demo flag / separate component until it is.

- **[Major] Magic-string connascence across a service boundary** —
  `chat-stream.ts:39-46`. `CATALOG_MUTATING_EVENTS` re-encodes backend domain-event
  knowledge as a hand-maintained `Set<string>` with no shared schema.
  **Connascence of meaning** (strong, cross-service, remote). A new backend
  mutating event silently fails to revalidate the lineage — no compile error, no
  runtime signal. The module comment already names adopting
  `@dashboard-chat/shared-chat` as the follow-up. *Direction:* take the event
  discriminants from the shared schema so there is one source of truth.

- **[Major] Presentation decision leaks into the app shell** — `Overlays.tsx:51,71`.
  "Which chat UI" is decided by a theme boolean (`useTheme().dark`) inside the
  Shell's overlay layer, not co-located with the theme hook or the Chat module.
  **Connascence of meaning** between the theme subsystem and chat. Every new chat
  variant (mobile, a11y) adds branching here. *Direction:* encapsulate the
  theme→variant mapping in a `useChatVariant()` hook or Chat-owned context.

- **[Major] `go` navigation callback prop-drilled through the tree** —
  `Chat.tsx:22` (prop), threaded to `Chat.tsx:200,224,443,462,477`; and
  `chats.tsx:6-7` → `ChatSessionList.tsx:12,47`. Navigation is an ambient
  capability, not per-instance config. `useNavIntents()` already exists and is
  called at the route (`chats.tsx:6`), so leaves can consume it directly.
  *Direction:* call `useNavIntents().go` in the leaf components; drop the prop.

### 3. State–presentation segregation

- **[Major] Core behavior lives inside a 566-line presentational module** —
  `Chat.tsx`. SSE parsing/accumulation, typing/busy state, error recovery
  (`runScript`, 110-162), the revalidation decision (71-76), context inference
  (52-66), and markdown rendering (38-46) all sit in the same file as the JSX.
  Consequence: the turn logic has **no unit test** — the only coverage is the
  acceptance test driving the full mounted `AssistantOverlay`
  (`__acceptance__/ssr-ui-server-chat-wire.test.tsx`) plus an error-path render
  test (`Chat.test.tsx`). *Direction:* extract `useChatTurn()` (turn state +
  `runScript`) and a `useRevalidateOnDomainEvent()` decision hook; the components
  become thin views and the logic becomes unit-testable and reusable across both
  variants.

- **[Minor] Inline hardcoded suggestions** — `Chat.tsx:169-173`. Content mixed
  into JSX; not tunable without redeploy. *Direction:* lift to config/a hook.

### 4. React idioms

- **[Major] Array-index keys on four mutable lists** — `Chat.tsx:247`
  (suggestions), `256` (msgs), `218`/`472` (recents), `ChatSessionList.tsx:40`
  (filtered chats). The chats list is *searched/filtered* (`ChatSessionList.tsx:17-23`),
  so index keys will mis-reconcile — reused DOM nodes, wrong focus/animation as
  the filter changes. *Direction:* key by stable IDs (`nodeId`/session id);
  stamp an id on messages at insertion if none exists.

- **[Minor] `fmt()` → `dangerouslySetInnerHTML`: escape-first ordering is a real
  guard, but implicit and duplicated** — `Chat.tsx:38-46`, rendered at
  `Chat.tsx:274` and `Chat.tsx:528`. Escaping `& < >` *before* the bold/code regex
  does neutralize the injection vectors those regexes could otherwise reopen, so
  it is currently safe — but the security-critical ordering is undocumented at
  the call sites and easy to break in a later edit. *Direction:* move `fmt()` to
  its own module with a security docstring, or adopt a vetted markdown +
  sanitizer (DOMPurify/micromark) so the guarantee is centralized and auditable.

- **[Minor] Scroll effect could be `useLayoutEffect`** — `Chat.tsx:99-102`,
  `349-352`. Imperative scroll-to-bottom after paint can flicker; a layout effect
  syncs before paint. Low priority.

---

## What's good (keep)

- **Un-buffered SSE relay** — `routes/ui-server/chat.tsx`. The server forwards
  `new Response(upstream.body)` and never reads the stream; bounded memory,
  incremental delivery, non-2xx passes through cleanly. Exemplary gateway
  separation.
- **Standalone frame reader** — `lib/chat-stream.ts`. `readChatStream()` is pure,
  React-free, buffers partial frames across chunk boundaries, and tolerates
  malformed frames without aborting the turn. Directly unit-testable.
- **Hygienic transient context** — `lib/chatContext.tsx`. Single-purpose,
  memoized value, `useChat()` guards misuse outside the provider. Keeps the
  overlay's open state out of the URL, as intended.
- **`agentFetch` reuses one proxy primitive** — `lib/agent-client.ts`. No
  duplicated cookie→Bearer hop; the credential-forwarding story is shared with
  `/api`.
- **Acceptance test exercises the real broker** — the SSR wire test stubs only
  `/worker/chat` and runs the real `/ui-server/chat` action, proving the hop
  end-to-end rather than mocking it.

---

## Recommended follow-up refactor tickets (prioritized)

**Tier 1 — before this ships**

1. **Add AbortController + unmount guard to the streaming turn** — own the turn in
   a hook, pass `signal` to `fetch`, abort on unmount, gate late callbacks
   (`Chat.tsx:110-162`, 99-102). *[Critical]*
2. **Wire `TerminalAssistant` to the real SSE turn (or gate the demo)** — remove
   the scripted `setTimeout` replay from the theme-selected production path
   (`Chat.tsx:364-396`). *[Major]*
3. **Replace array-index keys with stable IDs** — msgs/recents/suggestions/chats
   (`Chat.tsx:218,247,256,472`; `ChatSessionList.tsx:40`). *[Major]*

**Tier 2 — high-value structure**

4. **Extract `useChatTurn()` / `useRevalidateOnDomainEvent()`** — pull turn state
   and the revalidation decision out of the view; unlocks unit tests
   (`Chat.tsx:52-76,110-162`). *[Major]*
5. **Co-locate theme→variant selection** — move the dark/light choice out of
   `Overlays.tsx:70-87` into a chat-owned hook/context. *[Major]*
6. **Consume `useNavIntents()` in leaves; drop the `go` prop** —
   (`Chat.tsx:22`; `ChatSessionList.tsx:12`). *[Major]*

**Tier 3 — quality & clarity**

7. **Adopt `@dashboard-chat/shared-chat` for mutating-event discriminants** —
   retire the local `CATALOG_MUTATING_EVENTS` set (`chat-stream.ts:39-46`). *[Major]*
8. **Isolate/replace `fmt()` markdown with a documented sanitizer** —
   (`Chat.tsx:38-46`). *[Minor]*
9. **Document `agentContext()` precedence or lift to a typed guard** —
   (`Chat.tsx:52-66`). *[Minor]*
10. **Rename theme-driven variants for discoverability** — (`Chat.tsx:78,333`).
    *[Minor]*
