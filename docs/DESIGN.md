# Design Decisions

This documents engineering decisions beyond the core requirements - choices about code organization, testability, and quality assurance.

## Code Organization

The `src/lib/` directory separates concerns into three domains:

- **`chat/`** - Backend logic: Groq client, SSE streaming, request handling
- **`table-tools/`** - Shared tool execution: parsing tool calls, executing table operations
- **`ui/`** - Frontend: React components, hooks, sample data

This structure keeps backend and frontend code isolated while sharing the tool execution logic. Path aliases (`@/chat`, `@/table-tools`) provide clean imports without relative path gymnastics.

## Feature Specifications

Gherkin-style `.feature` files capture expected behavior as executable documentation:

```gherkin
Scenario: Filter by numeric comparison
  When the user asks to show products where quantity is greater than 50
  Then only matching products are displayed
```

This serves as a contract between developer and product owner (as a proxy for the user): it clearly documents scope, prevents ambiguity about what's in or out, and provides a natural place to capture new requirements as user feedback comes in. Scenarios are organized by operation type - filtering, sorting, adding rows, deleting rows.

## Testability Through Abstraction

Key functions use dependency injection to enable isolated testing:

**`executeToolCall(toolCall, handlers)`** receives table handlers as parameters rather than accessing global state. This lets tests verify tool execution without mounting a real table:

```typescript
const mockHandlers = {
  setColumnFilters: vi.fn(),
  setSorting: vi.fn(),
  setData: vi.fn(),
};
executeToolCall(toolCall, mockHandlers);
expect(mockHandlers.setColumnFilters).toHaveBeenCalledWith(/* ... */);
```

**`handleChat(request, client, options)`** accepts a `ChatClient` interface rather than hardcoding the Groq client. Tests can inject a mock client that returns predictable responses without hitting an external API.

The pattern: functions are pure where possible, side effects are injected as dependencies.

## E2E Testing Strategy

E2E tests align with the feature specifications - each scenario in the `.feature` file maps to test coverage in Playwright. This keeps acceptance criteria and automated verification in sync.

Playwright tests run against both local and production environments using split configurations:

- **`e2e/config/local.config.ts`** - Automatically starts both dev servers, runs against localhost
- **`e2e/config/production.config.ts`** - Points to deployed Cloudflare URLs

Helper utilities (`table.helper.ts`, `wait.helper.ts`) encapsulate common assertions and waiting patterns, keeping specs focused on behavior rather than mechanics.

**Trade-offs:** E2E tests speed up regression - changes can be validated against the full feature set in seconds rather than manual testing. The cost is maintenance overhead and coupling to specific UI rendering (table structure, CSS selectors, text content), despite deliberate effort to ensure E2E tests avoid coupling to framework internals (no React component imports, no TanStack state inspection).

## Unit Testing Approach

Tests cover core behavior and error states - API failures, missing response bodies, malformed inputs, and edge cases like partial SSE chunks buffered across network reads.

The dependency injection patterns above mean tests can inject mock clients that return predictable responses (or predictable errors) without network calls. This enables testing error handling paths that would be difficult to trigger reliably against a real API.
