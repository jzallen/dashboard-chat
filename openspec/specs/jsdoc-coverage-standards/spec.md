# jsdoc-coverage-standards Specification

## Purpose
TBD - created by archiving change frontend-readability. Update Purpose after archive.
## Requirements
### Requirement: JSDoc on exported hooks
Every exported custom hook in `frontend/src/lib/ui/hooks/` SHALL have a JSDoc comment describing its purpose. Hooks with complex signatures (2+ options or non-obvious return values) SHALL include `@param` and/or `@returns` annotations.

#### Scenario: Simple query hook
- **WHEN** a hook wraps a single TanStack Query call (e.g., `useProjectQuery`)
- **THEN** it SHALL have at minimum a one-line JSDoc describing what it fetches (e.g., `/** Fetches and caches the project by ID. */`)

#### Scenario: Complex hook with options interface
- **WHEN** a hook accepts an options object with 3+ fields (e.g., `useTransforms`)
- **THEN** the JSDoc SHALL include `@param` lines for non-obvious options and a brief description of the hook's lifecycle behavior

#### Scenario: Mutation hooks
- **WHEN** a hook returns a mutation function (e.g., `useRenameDataset`, `useSaveTransform`)
- **THEN** the JSDoc SHALL describe what the mutation does and what it invalidates

### Requirement: JSDoc on context providers
Every exported context provider and its associated `use*` hook in `frontend/src/lib/` SHALL have a JSDoc comment describing the context's purpose and key behaviors.

#### Scenario: ChatContext provider
- **WHEN** `ChatProvider` is the context provider for SSE chat streaming
- **THEN** its JSDoc SHALL describe the streaming mechanism, tool call execution, and session management it provides

#### Scenario: Context consumer hook
- **WHEN** `useChatContext` is the consumer hook for ChatContext
- **THEN** its JSDoc SHALL describe what values it provides and note that it must be used within the provider

### Requirement: JSDoc on table-tools exports
Every exported function, type, and interface in `frontend/src/lib/table-tools/` SHALL have a JSDoc comment.

#### Scenario: Main entry point function
- **WHEN** `executeToolCall` is the primary exported function
- **THEN** its JSDoc SHALL describe the function's role (dispatching validated tool calls to handlers), its parameters, and its async/sync behavior

#### Scenario: Discriminated union types
- **WHEN** `ToolCallArgs` is a discriminated union of all tool call argument shapes
- **THEN** its JSDoc SHALL describe the union's purpose and note the discriminant field (`tool`)

#### Scenario: Handler interface
- **WHEN** `ToolCallHandlers` defines callbacks for each tool operation
- **THEN** its JSDoc SHALL describe that it maps tool names to their execution callbacks

### Requirement: JSDoc on component props interfaces and exported components
Exported React components in `frontend/src/lib/ui/components/` with non-trivial props (2+ props, or any prop whose purpose is not self-evident from its name and type) SHALL have JSDoc on the component function. Props interfaces SHALL have field-level JSDoc for any ambiguous fields.

#### Scenario: Component with simple props
- **WHEN** a component has 1-2 props with self-explanatory names and types (e.g., `mode: string`, `onModeChange: (m: string) => void`)
- **THEN** a one-line JSDoc on the component function is sufficient; per-field docs are not required

#### Scenario: Component with complex callback props
- **WHEN** a component accepts callbacks that trigger side effects (e.g., `onFilterApply`, `onFiltersChanged`)
- **THEN** those callback props SHALL have JSDoc explaining when they fire and what arguments they receive

#### Scenario: Container components with significant logic
- **WHEN** a component manages state machines, SSE connections, or multi-step workflows (e.g., `ChatPanel`, `DatasetView`, `SqlAccessPanel`)
- **THEN** the component function's JSDoc SHALL briefly describe the component's responsibilities

### Requirement: Inline comment promotion
Existing `//` comments that describe a function's purpose, a type's intent, or a module's role SHALL be promoted to `/** */` JSDoc comments on the corresponding symbol. The inline comment SHALL be removed after promotion.

#### Scenario: Section comment above a function
- **WHEN** a `//` comment like `// --- Table tool actions (synchronous) ---` appears above a function definition
- **THEN** the comment SHALL be converted to a JSDoc comment on the function: `/** Table tool actions — executed synchronously against the in-memory table. */`

#### Scenario: Inline comment explaining a variable
- **WHEN** a `//` comment explains a local variable inside a function body
- **THEN** the comment is NOT promoted — JSDoc promotion only applies to exported symbols, types, and function signatures

### Requirement: JSDoc style consistency
All new JSDoc SHALL follow the style established in `frontend/src/lib/api/client.ts`: one-line for simple symbols, multi-line with `@param`/`@returns` only when the signature is non-obvious.

#### Scenario: One-line JSDoc
- **WHEN** a function has a clear name and 0-1 parameters
- **THEN** the JSDoc SHALL be a single line: `/** Brief description. */`

#### Scenario: Multi-line JSDoc
- **WHEN** a function has 2+ parameters with non-obvious semantics or an options object
- **THEN** the JSDoc SHALL use multi-line format with `@param` tags for non-obvious parameters

