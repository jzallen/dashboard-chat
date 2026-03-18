## Why

The `lib/auth/` package conflates pure business logic (token storage, refresh, fetch decorators) with React lifecycle concerns (context provider, inactivity tracking, cross-tab sync). `tokenStorage.ts` exports raw localStorage key constants (`TOKEN_KEY`, `REFRESH_TOKEN_KEY`, etc.) instead of an encapsulated getter/setter API, forcing consumers to know implementation details. `AuthContext.tsx` is a 265-line monolith handling five distinct responsibilities. This makes the auth layer harder to maintain and reason about.

## What Changes

- **BREAKING**: `AuthProvider` and `useAuth` move from `lib/auth/` to `lib/ui/context/AuthContext/` — all consumer imports change
- **BREAKING**: `tokenStorage.ts` stops exporting raw key constants (`TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY`) — replaced by getter/setter functions (`getToken()`, `setToken()`, etc.)
- `AuthContext.tsx` is decomposed into three focused units: `useTokenState` hook (mount restore, proactive refresh timer, cross-tab sync), `useInactivity` hook (event listeners, timeout, modal state), and a slim `AuthProvider` that composes them
- `lib/auth/index.ts` barrel exports only Layer 1 (business logic) — no React exports
- `tokenRefresh.ts` and `withAuth.ts` updated to use getter/setter API instead of raw constants
- New `clearAll()` function extracted from `hardLogout()` for reuse by `logout()`

## Capabilities

### New Capabilities

- `auth-token-storage-api`: Encapsulated getter/setter API for auth token localStorage operations, replacing raw key constant exports
- `auth-context-decomposition`: Decomposed AuthProvider with extracted `useTokenState` and `useInactivity` hooks, relocated from `lib/auth/` to `lib/ui/context/AuthContext/`

### Modified Capabilities

- `auth-fetch-decorator`: The "Auth utilities located in lib/auth package" requirement changes — `tokenStorage` exports functions instead of constants, and `AuthProvider`/`useAuth` move to `lib/ui/context/AuthContext/`
- `token-refresh`: The "Frontend stores refresh token and expiry timestamp" requirement is unchanged in behavior but `tokenRefresh.ts` internally uses getter/setter API instead of raw constants

## Impact

- **Frontend auth package** (`lib/auth/`): tokenStorage.ts, tokenRefresh.ts, withAuth.ts, index.ts all modified
- **Frontend context layer** (`lib/ui/context/AuthContext/`): 4 new files (AuthProvider.tsx, hooks/useTokenState.ts, hooks/useInactivity.ts, index.ts)
- **Consumer imports**: 5 component files + App.tsx change import paths for AuthProvider/useAuth
- **Test imports**: 2-3 test files update import paths and mock paths
- **No backend changes**: This is a frontend-only structural refactor
- **No behavioral changes**: All auth flows (login, logout, refresh, 401 retry, inactivity, cross-tab sync) work identically
