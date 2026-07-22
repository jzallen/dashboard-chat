# Walking Skeleton — ssr-ui-server-gateway slice 1 (notes)

> The `.feature`-equivalent SSOT is the executable test:
> `ui/app/__acceptance__/ssr-ui-server-chat-wire.test.tsx`. This file is notes only.

## Scenario (Given-When-Then)

```gherkin
Feature: Live assistant chat through the ui/ SSR ui-server gateway

  @walking_skeleton @real-io
  Scenario: A user's chat message streams a real assistant turn through the ui/
            server broker, and a transform event refreshes the catalog
    Given the ui/ app runs with a server runtime (ssr:true)
      And the assistant overlay's setTimeout mock is removed for the submit path
      And the agent (reached via auth-proxy /worker/chat) will stream one assistant
          turn containing text and a transform_applied event
    When the user submits a chat message in the AssistantOverlay
    Then the overlay POSTs to the /ui-server/chat resource route (the ui/ server broker)
      And the broker relays the agent SSE straight back, un-buffered
      And the streamed assistant text appears in the transcript
      And the transform_applied event triggers catalog.revalidateScope()
```

## Driving port / port-to-port

- **Driving port (client):** the `AssistantOverlay` submit handler — the real user
  entry point, mock removed.
- **Server broker port:** the REAL `/ui-server/chat` RRv7 resource-route `action`
  (exercised, not stubbed) — this is what makes a Tested-But-Unwired defect
  impossible: the test cannot pass unless the action is wired and relays.
- **Mocked downstream port (sole fake):** auth-proxy's `/worker/chat` agent
  upstream, stubbed via `fetch` with a canned AI-SDK-v6 SSE turn.

## Why a ui/ vitest integration test (not a Python e2e suite)

See DWD-6. The thinnest faithful proof runs the real client + real broker in one
process and fakes only the true external port. A Python `tests/acceptance/` suite
would need a live four-container stack (vite dev + auth-proxy + agent + backend),
which is heavier than faithful for a walking skeleton. Manual `vite dev`-loop
validation covers the real-stack edges the fake can't model (real SSE backpressure,
auth-proxy header injection, Groq latency, transform persistence).

## RED → GREEN

RED on creation: the overlay still replays the scripted mock (no fetch), the
`/ui-server/chat` action is a `__SCAFFOLD__` throw, and `catalog.revalidateScope` does
not yet exist. GREEN after DELIVER steps 4 (action), 5 (reader), 6 (overlay
rewire), 7 (revalidateScope). Steps 1-3 (ssr:true, agent-client, /ui-server/health) are
prerequisites proven by their own unit tests + the build.
