## Context

The frontend codebase has grown organically over multiple feature additions. The `api/` and `raqb/` layers were written with JSDoc from the start and remain well-documented. However, subsequent layers — hooks, components, context, table-tools, and auth — were added without documentation standards. Similarly, conditional logic accumulated complexity as features like token refresh retries, sync state machines, and multi-tool validation were implemented incrementally.

The `frontend-code-quality` change (separate, in-progress) addresses type safety, correctness, and React anti-patterns. This change is complementary — it targets pure readability without behavior changes.

## Goals / Non-Goals

**Goals:**
- Eliminate nested ternaries, deeply nested control flow, and long boolean expressions from all files identified in the audit
- Establish reusable patterns (named predicates, className helpers, early returns, declarative validation) that new code can follow
- Bring JSDoc coverage from ~28% to 80%+ for exported APIs (hooks, components, context, table-tools, auth)
- Use the existing `api/client.ts` and `raqb/types.ts` documentation style as the standard

**Non-Goals:**
- Changing runtime behavior — every refactored conditional must produce identical results
- Adding JSDoc to private/internal functions — only exported symbols and complex internals
- Documenting component render logic line-by-line — JSDoc goes on the component function, props interface, and non-obvious hooks
- Refactoring the tool call type system — the `frontend-code-quality` change handles discriminated unions and type safety
- Adding a linting rule to enforce JSDoc — that can come later once the baseline is established

## Decisions

### 1. className construction: `clsx` vs inline helper

**Decision**: Use `clsx` (228 bytes gzipped, zero dependencies).

**Alternatives considered**:
- *Inline helper function*: No dependency, but reinvents a solved problem and lacks the conditional-object syntax (`clsx({ active: isActive })`)
- *Template literals with extracted variables*: Reduces line length but still produces messy string concatenation

**Rationale**: `clsx` is the de facto standard in the React ecosystem. It handles falsy value elimination, conditional objects, and arrays. The existing codebase already uses Tailwind CSS — `clsx` is the conventional companion.

**Example** (DatasetView sync button, line 431):
```tsx
// Before
className={`${styles.syncButton} ${syncState === "spinning" ? styles.syncSpinning : ""} ${syncState === "success" ? styles.syncSuccess : ""} ${syncState === "cooldown" ? styles.syncCooldown : ""}`}

// After
className={clsx(styles.syncButton, {
  [styles.syncSpinning]: syncState === "spinning",
  [styles.syncSuccess]: syncState === "success",
  [styles.syncCooldown]: syncState === "cooldown",
})}
```

### 2. Nested control flow: extract helper functions vs flatten with early returns

**Decision**: Flatten with early returns for linear flows; extract named helper functions for self-contained sub-operations.

**Rationale**: The ChatContext token refresh (lines 144-199) has two distinct operations — pre-check and 401-retry — that are currently interleaved in one function. Extracting them as named async helpers (`refreshAuthHeaders`, `retryOn401`) makes each operation scannable independently while keeping the top-level `sendMessage` flow flat.

**Example** (ChatContext, lines 144-199):
```tsx
// Before: 3 levels of nesting, two separate 401 paths interleaved
if (expiresAtStr) {
  const expiresAt = Number(expiresAtStr);
  if (expiresAt - Date.now() < 60_000) {
    try { ... } catch { ... }
  }
}
// ... fetch ...
if (response.status === 401) {
  try { ... } catch { ... }
  if (response.status === 401) { ... }
}

// After: flat sequence with named helpers
const authHeaders = await refreshAuthHeadersIfExpiring();
let response = await fetchChat(authHeaders, apiMessages, tableSchema);
response = await retryOn401(response, apiMessages, tableSchema);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
```

### 3. Validation switch: keep switch vs declarative schema map

**Decision**: Replace the 59-line switch with a declarative validator map keyed by tool name.

**Alternatives considered**:
- *Keep the switch, add comments*: Lowest effort, but the repetitive pattern (check typeof → throw → return typed object) is error-prone and will grow with each new tool
- *Zod/Valibot runtime schemas*: Full runtime + compile-time safety, but adds a dependency for one function — deferred to `frontend-code-quality` change

**Rationale**: A map of `{ toolName: validatorFn }` eliminates the repetitive switch boilerplate while keeping the same validation logic. Each validator is a 1-3 line function that's easy to review. Adding a new tool means adding one map entry rather than finding the right position in a long switch.

### 4. JSX guard consolidation: wrapper component vs conditional block

**Decision**: Group repeated guards into a single conditional block rather than extracting a wrapper component.

**Rationale**: The DatasetView toolbar (lines 407-443) repeats `viewMode === "table" &&` three times for adjacent buttons. Wrapping these in a single `{viewMode === "table" && (<> ... </>)}` block is cleaner than creating a `<TableModeToolbar>` component that would add indirection without reuse.

### 5. JSDoc style: brief vs detailed

**Decision**: Follow the existing `api/client.ts` pattern — one-line description for simple functions, multi-line with `@param`/`@returns` only for complex signatures.

**Examples**:
```tsx
// Simple hook — one-line JSDoc
/** Fetches and caches the project by ID. */
export function useProjectQuery(projectId: string) { ... }

// Complex hook — multi-line with params
/**
 * Manages transform lifecycle (save, delete, toggle) for a dataset.
 * Automatically applies active filter transforms when the dataset loads.
 *
 * @param options.dataset - The dataset whose transforms to manage (null during loading)
 * @param options.onFilterApply - Callback to push filter state to TanStack Table
 * @param options.autoApplyActive - Whether to auto-apply saved filters on mount (default: true)
 */
export function useTransforms(options: UseTransformsOptions): UseTransformsReturn { ... }
```

Props interfaces get field-level JSDoc only when the name alone is ambiguous.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Conditional refactoring introduces subtle behavior change | Every refactored file must pass existing tests unchanged. No test modifications allowed in the conditional-logic workstream. |
| `clsx` dependency objection | 228 bytes gzipped, zero transitive deps, widely adopted. If rejected, fall back to an inline `cx()` helper. |
| JSDoc goes stale as code evolves | Keep docs minimal — describe purpose, not implementation. One-liners are easier to maintain than detailed paragraphs. |
| Overlap with `frontend-code-quality` change | Scoped to different concerns. `frontend-readability` does not touch type signatures, React patterns, or TanStack Query usage. If both changes touch the same file, readability changes are additive (JSDoc, variable extraction) and merge cleanly. |
| Large diff size across ~25 files | Split into two independently-mergeable PRs: (1) conditional logic, (2) JSDoc. Each PR groups changes by directory. |
