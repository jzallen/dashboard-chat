## Context

The frontend auth package (`lib/auth/`) currently contains both pure business logic and React-specific code in a flat structure. `tokenStorage.ts` leaks implementation details by exporting raw localStorage key constants. `AuthContext.tsx` is a 265-line monolith handling mount restoration, login/logout flows, proactive refresh, cross-tab sync, and inactivity tracking. The `lib/ui/context/` directory already has a well-structured `ChatContext/` with hooks and services subdirectories that serves as the pattern to follow.

**Current consumers:**
- API layer (`client.ts`, `chatClient.ts`, `projects.ts`) — imports `withAuth`/`withPreAuth` from `lib/auth/withAuth`
- React components (App.tsx, LoginPage, LogoutPage, AuthCallback, CreateOrg) — imports `AuthProvider`/`useAuth` from `lib/auth`
- `ActivityDebugBadge` — imports `ACTIVITY_KEY` constant directly
- Tests — import from both `lib/auth` and `lib/auth/tokenRefresh`

## Goals / Non-Goals

**Goals:**
- Separate pure business logic (Layer 1: `lib/auth/`) from React lifecycle (Layer 2: `lib/ui/context/AuthContext/`)
- Encapsulate `tokenStorage.ts` behind a getter/setter API — no raw constants exported
- Decompose `AuthContext.tsx` into focused, composable hooks
- Follow the existing `ChatContext/` directory pattern for consistency
- Zero behavioral changes — all auth flows work identically after refactor

**Non-Goals:**
- Adding a `@/auth` path alias (insufficient import count to justify; existing consumers use 2-3 distinct relative paths)
- Changing auth behavior (refresh timing, retry logic, inactivity thresholds)
- Refactoring the backend auth layer
- Moving `withAuth`/`withPreAuth` out of `lib/auth/` (they're correctly placed as non-React business logic)

## Decisions

### Decision 1: Two-layer architecture

**Choice:** Split into `lib/auth/` (pure JS, no React) and `lib/ui/context/AuthContext/` (React context + hooks).

**Rationale:** The API layer (`client.ts`, `chatClient.ts`) needs auth utilities outside React. The `withAuth` fetch decorator, `ensureFreshToken()`, and token storage are used by plain modules that cannot use hooks. Separating these from the React provider enforces the constraint that business logic has no React dependency.

**Alternative considered:** Keep everything in `lib/auth/` but split into subfolders (`lib/auth/core/`, `lib/auth/react/`). Rejected because the existing codebase convention places React contexts in `lib/ui/context/` — following the convention is more important than co-location.

### Decision 2: Getter/setter API with key predicates

**Choice:** Replace exported constants with functions: `getToken()`/`setToken()`, `getRefreshToken()`/`setRefreshToken()`, `getTokenExpiry()`/`setTokenExpiry()`, `getLastActivity()`/`setLastActivity()`, `getUser()`/`setUser()`. Add `isTokenKey(key)`/`isExpiryKey(key)` predicates for cross-tab sync.

**Rationale:** Consumers currently do `localStorage.getItem(TOKEN_KEY)` — they know both the storage mechanism and the key name. Getter/setters encapsulate both. The predicates solve a specific problem: the `storage` event listener in cross-tab sync needs to match `e.key` against key names, but the constants are now private. Predicates keep keys centralized without re-exporting them.

**Alternative considered:** Export a single `tokenStore` object with methods. Rejected because individual named exports are more tree-shakeable and match the existing style of the codebase.

### Decision 3: Extract clearAll() from hardLogout()

**Choice:** `hardLogout()` becomes `clearAll()` + `window.location.href = "/login"`. Both are exported. `logout()` in AuthProvider uses `clearAll()` + server revocation + state reset (no redirect — React handles navigation).

**Rationale:** Currently `logout()` duplicates the localStorage cleanup from `hardLogout()` because `hardLogout()` also forces a redirect. Extracting `clearAll()` eliminates this duplication and makes the emergency (redirect) vs. graceful (React state) distinction explicit.

### Decision 4: useTokenState hook owns mount + refresh + cross-tab sync

**Choice:** A single `useTokenState()` hook encapsulates three effects from AuthContext: mount restoration, proactive refresh timer, and cross-tab storage sync. Returns `{ state: AuthState, setState }`.

**Rationale:** These three effects are tightly coupled — they all read/write the same `AuthState` and interact through `tokenExpiresAt` changes. Splitting them into separate hooks would require sharing state via additional coordination. The `setState` return allows the provider to update state from login/logout/callback without duplicating state management.

### Decision 5: useInactivity hook is separate

**Choice:** `useInactivity(isAuthenticated, logout)` is a standalone hook returning `{ showModal, handleContinue, handleLogout }`.

**Rationale:** Inactivity tracking has no coupling to token state — it only needs `isAuthenticated` (to enable/disable) and `logout` (to call on timeout). This clean interface makes it independently testable and potentially reusable.

### Decision 6: Two-commit strategy

**Choice:** Commit 1 refactors tokenStorage API + updates tokenRefresh/withAuth (pure business logic). Commit 2 moves AuthContext, extracts hooks, updates consumer imports.

**Rationale:** Commit 1 is independently valuable and correct — all tests pass after it. If commit 2 introduces issues, the business logic refactor is already landed. This matches the layer boundary: Layer 1 first, Layer 2 second.

## Risks / Trade-offs

**[Risk: Import churn across tests]** → 2-3 test files change import paths and mock targets. Mitigation: mechanical find-and-replace; tests validate correctness immediately.

**[Risk: Cross-tab sync predicate coupling]** → `isTokenKey()`/`isExpiryKey()` create an implicit contract between tokenStorage and useTokenState. If key names change, both must update. → Mitigation: keys are stable (used in existing localStorage and tests); predicates centralize the knowledge in one place.

**[Risk: setState identity in useTokenState]** → The hook returns React's `setState` for the provider to use in callbacks. → Mitigation: `useState`'s setter has stable identity (React guarantee), so it won't cause unnecessary re-renders when passed as a dependency.

**[Trade-off: No @/auth alias]** → Consumers use relative imports (`../../auth/`, `../../../auth/`). Adding an alias would simplify paths but introduce a third import style alongside existing patterns. The 8 files affected don't justify the inconsistency.
