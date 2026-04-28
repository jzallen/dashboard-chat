# Documentation companion — runnable specs live alongside as *.test.ts(x) files.
# DISTILL SSOT for FE-side scenario inventory.

Feature: Frontend handles a closed, typed SSE event vocabulary
  Story 2 / AC2.1–AC2.4  |  Story 3 / AC3.1–AC3.3  |  K3

  Background:
    Given the chat-panel component renders inside a QueryClientProvider

  # ---- AC2.1: exhaustiveness ---------------------------------------------

  @pr0 @in-memory @pending @skip
  Scenario: handleChatEvent compiles only when every ChatEvent variant has a case
    Given the eventHandler.ts switch on event.type
    When the test imports it under a mocked TS compilation context where one variant is removed from the case list
    Then TypeScript compilation fails on the `default: const _: never = event` line
    # NOTE: this is asserted via a tsd / type-only test, not a runtime test.

  # ---- AC2.2: canonical reaction per event type --------------------------

  @pr1 @in-memory @pending @skip
  Scenario: transform_applied invalidates the dataset detail query
    Given a fresh QueryClient with a populated datasetKeys.detail("ds-456") cache entry
    And a MockSSESource subscribed by the chat panel
    When the source emits { type: "transform_applied", transform_id: "t-1", dataset_id: "ds-456", operation: "trim", column: "region" }
    Then queryClient.invalidateQueries was called with queryKey datasetKeys.detail("ds-456")

  @pr2 @in-memory @pending @skip
  Scenario: row_added invalidates the dataset detail query
    Given a fresh QueryClient
    When the source emits { type: "row_added", dataset_id: "ds-456", row_id: "r-1" }
    Then queryClient.invalidateQueries was called with queryKey datasetKeys.detail("ds-456")

  @pr2 @in-memory @pending @skip
  Scenario: column_renamed invalidates the dataset detail query
    Given a fresh QueryClient
    When the source emits { type: "column_renamed", dataset_id: "ds-456", old_name: "region", new_name: "geo_region" }
    Then queryClient.invalidateQueries was called with queryKey datasetKeys.detail("ds-456")

  @pr3 @in-memory @pending @skip
  Scenario: sort_directive applies sort via the shared dispatcher
    Given a TanStack Table with no current sort
    And the chat panel rendered with the table api
    When the source emits { type: "sort_directive", column: "region", direction: "desc" }
    Then table.setSorting was called with [{ id: "region", desc: true }]

  @pr3 @in-memory @pending @skip
  Scenario: filter_directive merges into existing column filters via shared dispatcher
    Given a TanStack Table with existing filter on column "status"
    When the source emits { type: "filter_directive", column: "region", filters: [{ op: "in", values: ["US"] }] }
    Then table.setColumnFilters was called with the merged filter list (status preserved, region added)

  @pr3 @in-memory @pending @skip
  Scenario: filters_cleared resets all column filters via shared dispatcher
    Given a TanStack Table with multiple column filters set
    When the source emits { type: "filters_cleared" }
    Then table.resetColumnFilters was called once

  @pr1 @in-memory @pending @skip
  Scenario: error_occurred triggers a toast with the event's message
    Given a toast double
    When the source emits { type: "error_occurred", phase: "backend_dispatch", message: "boom", retryable: false }
    Then toast.error was called with "boom"

  @pr1 @in-memory @pending @skip
  Scenario: turn_done clears the chat panel "thinking" indicator
    Given the chat panel's thinking indicator is visible
    When the source emits { type: "turn_done", reason: "stop" }
    Then the thinking indicator is no longer visible in the rendered DOM

  @pr0 @in-memory @pending @skip
  Scenario: assistant_text_delta accumulates into the chat panel's transcript
    Given the chat panel transcript is empty
    When the source emits two assistant_text_delta events with deltas "Hello, " and "world."
    Then the chat panel transcript contains "Hello, world."

  # ---- AC2.4: direct-UI clicks share the dispatcher ----------------------

  @pr3 @in-memory @pending @skip
  Scenario: Column-header sort click calls the same dispatcher as sort_directive
    Given a TanStack Table column header for "region"
    When the user clicks the header
    Then applyDirective was called with { kind: "sort", column: "region", direction: "asc" }
    And no SSE connection was opened
    And no fetch to the agent occurred

  # ---- AC3.x: MockSSESource contract -------------------------------------

  @pr0 @in-memory @pending @skip
  Scenario: MockSSESource synchronously delivers emit() to all subscribers
    Given a MockSSESource with two subscribers
    When emit() is called once with a transform_applied event
    Then both subscriber callbacks were invoked exactly once
    And each received the same event reference

  @pr0 @in-memory @pending @skip
  Scenario: MockSSESource.emitSequence preserves order
    Given a MockSSESource
    When emitSequence is called with [ev1, ev2, ev3]
    Then a recording subscriber observed the events in the order [ev1, ev2, ev3]

  @pr0 @in-memory @pending @skip
  Scenario: MockSSESource subscribe returns an unsubscribe function
    Given a MockSSESource with one subscriber
    When the subscriber's unsubscribe function is invoked
    And emit() is called
    Then the (now-unsubscribed) callback is NOT invoked

  # ---- K3 perf check (soft) ----------------------------------------------

  @kpi @perf @in-memory @pending @skip
  Scenario: Each FE component test in this file completes in under 100ms
    Given vitest test duration timing is enabled
    When the chat-panel suite runs to completion
    Then no individual test in this feature file took longer than 100ms
    # NOTE: soft assertion via afterEach hook printing duration; failure threshold is informational only (TWD-11).

  # ---- Schema runtime equivalence (TWD-8) -------------------------------

  @pr0 @structural @pending @skip
  Scenario: agent's ChatEventSchema and frontend's ChatEventSchema parse every variant identically
    Given a sample of every event variant in the vocabulary
    When each is parsed by both schemas
    Then both produce identical parsed values
    And neither raises on any input
