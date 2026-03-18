## 1. Encapsulate tokenStorage API

- [x] 1.1 Refactor `frontend/src/lib/auth/tokenStorage.ts`: make `TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY` private. Add private `USER_KEY = "auth_user"`. Export getter/setter pairs: `getToken`/`setToken`, `getRefreshToken`/`setRefreshToken`, `getTokenExpiry`/`setTokenExpiry`, `getLastActivity`/`setLastActivity`, `getUser`/`setUser`. Export `clearAll()` (extracted from `hardLogout`), `isTokenKey(key)`, `isExpiryKey(key)`. Update `hardLogout()` to call `clearAll()` + redirect.
- [x] 1.2 Update `frontend/src/lib/auth/tokenRefresh.ts`: replace all `localStorage.getItem(TOKEN_KEY)` with `getToken()`, `localStorage.getItem(REFRESH_TOKEN_KEY)` with `getRefreshToken()`, `localStorage.getItem(EXPIRES_AT_KEY)` with `getTokenExpiry()`, and all `localStorage.setItem` calls with corresponding setters.
- [x] 1.3 Update `frontend/src/lib/auth/withAuth.ts`: replace `localStorage.getItem(EXPIRES_AT_KEY)` with `getTokenExpiry()` in `withPreAuth`. Remove `EXPIRES_AT_KEY` from imports.
- [x] 1.4 Update `frontend/src/lib/auth/index.ts` barrel: replace old constant exports (`TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY`) with new getter/setter/predicate exports. Remove `AuthProvider` and `useAuth` exports.
- [x] 1.5 Update `frontend/src/lib/ui/components/ActivityDebugBadge.tsx`: replace `import { ACTIVITY_KEY }` with `import { getLastActivity }`, use `getLastActivity()` instead of `localStorage.getItem(ACTIVITY_KEY)`.
- [x] 1.6 Run `cd frontend && npx vitest run` to verify all existing tests pass with the new API.

## 2. Create AuthContext in context layer

- [x] 2.1 Create `frontend/src/lib/ui/context/AuthContext/hooks/useTokenState.ts`: extract mount restoration (lines 39-69 of old AuthContext.tsx), proactive refresh timer (lines 120-165), and cross-tab sync (lines 168-191). Use getter/setter API from `lib/auth/tokenStorage` and `ensureFreshToken` from `lib/auth/tokenRefresh`. Return `{ state: AuthState, setState }`.
- [x] 2.2 Create `frontend/src/lib/ui/context/AuthContext/hooks/useInactivity.ts`: extract inactivity tracking (lines 194-243 of old AuthContext.tsx). Signature: `useInactivity(isAuthenticated: boolean, logout: () => void)`. Return `{ showModal, handleContinue, handleLogout }`. Use `getLastActivity`/`setLastActivity` from `lib/auth/tokenStorage`.
- [x] 2.3 Create `frontend/src/lib/ui/context/AuthContext/AuthProvider.tsx`: compose `useTokenState` + `useInactivity`. Implement `login`, `handleCallback` (using setter functions), `logout` (using `clearAll()`). Render `ActivityCheckModal` and `ActivityDebugBadge`. Export `AuthProvider` and `useAuth`.
- [x] 2.4 Create `frontend/src/lib/ui/context/AuthContext/index.ts`: barrel re-export `AuthProvider` and `useAuth` from `./AuthProvider`.

## 3. Update consumer imports

- [x] 3.1 Update `frontend/App.tsx`: change `AuthProvider` import from `lib/auth` to `lib/ui/context/AuthContext`.
- [x] 3.2 Update `frontend/src/lib/ui/components/AuthCallback/index.tsx`: change `useAuth` import from `../../../auth` to `../../context/AuthContext`.
- [x] 3.3 Update `frontend/src/lib/ui/components/CreateOrg/index.tsx`: change `useAuth` import from `../../../auth` to `../../context/AuthContext`.
- [x] 3.4 Update `frontend/src/lib/ui/components/LoginPage/index.tsx`: change `useAuth` import from `../../../auth` to `../../context/AuthContext`.
- [x] 3.5 Update `frontend/src/lib/ui/components/LogoutPage/index.tsx`: change `useAuth` import from `../../../auth` to `../../context/AuthContext`.

## 4. Update tests and cleanup

- [x] 4.1 Update `frontend/src/test/auth/AuthContext.test.tsx`: change imports and mocks from `lib/auth` to `lib/ui/context/AuthContext`.
- [x] 4.2 Update `frontend/src/test/auth/refreshTimer.test.tsx`: change `AuthProvider`/`useAuth` imports to `lib/ui/context/AuthContext`; keep `_resetRefreshState` from `lib/auth/tokenRefresh`.
- [x] 4.3 Update any other test files that mock `lib/auth` for `useAuth`/`AuthProvider` (check LoginPage, AuthCallback test files).
- [x] 4.4 Delete `frontend/src/lib/auth/AuthContext.tsx`.
- [x] 4.5 Run `cd frontend && npx vitest run` to verify all tests pass.
- [x] 4.6 Run `cd frontend && npx tsc --noEmit` to verify no type errors.
