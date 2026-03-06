# auth-context-decomposition Specification

## Purpose
Decomposes the AuthProvider into focused hooks (useTokenState, useInactivity) and relocates React-specific auth code to `lib/ui/context/AuthContext/`, separating it from the pure business logic in `lib/auth/`.

## Requirements

### Requirement: AuthProvider and useAuth are exported from lib/ui/context/AuthContext
The `AuthProvider` component and `useAuth` hook SHALL be located in `lib/ui/context/AuthContext/` and exported from its barrel `index.ts`. They SHALL NOT be exported from `lib/auth/`.

#### Scenario: AuthProvider import path
- **WHEN** a React component needs to use `AuthProvider` or `useAuth`
- **THEN** it SHALL import from `lib/ui/context/AuthContext` (or relative path equivalent)
- **AND** importing `AuthProvider` or `useAuth` from `lib/auth` SHALL NOT be possible

#### Scenario: AuthProvider composes useTokenState and useInactivity
- **WHEN** `AuthProvider` renders
- **THEN** it SHALL delegate token state management to the `useTokenState` hook
- **AND** delegate inactivity tracking to the `useInactivity` hook
- **AND** provide `login`, `logout`, and `handleCallback` actions via context

### Requirement: useTokenState hook manages reactive token state
The `useTokenState` hook SHALL encapsulate mount restoration, proactive refresh timer, and cross-tab sync in a single hook. It SHALL return `{ state: AuthState, setState }`.

#### Scenario: Mount restoration in dev mode
- **WHEN** `useTokenState` mounts and `VITE_AUTH_MODE` is `"dev"`
- **THEN** it SHALL write dev defaults to localStorage via setter functions
- **AND** set state to authenticated with the dev user

#### Scenario: Mount restoration in WorkOS mode
- **WHEN** `useTokenState` mounts and `VITE_AUTH_MODE` is not `"dev"`
- **THEN** it SHALL read token and user from localStorage via getter functions
- **AND** if both exist, set state to authenticated
- **AND** if either is missing, set state to unauthenticated with `isLoading: false`

#### Scenario: Proactive refresh timer fires at 80% TTL
- **WHEN** state has a valid `tokenExpiresAt` and `isAuthenticated` is true
- **THEN** the hook SHALL schedule `ensureFreshToken()` at `max(TTL * 0.8, 10000)` ms
- **AND** on success, sync the new token state from localStorage into React state

#### Scenario: Proactive refresh retry on failure
- **WHEN** the proactive refresh fails
- **THEN** the hook SHALL retry up to 3 total attempts with delays of 30s then 60s
- **AND** if all attempts fail, it SHALL stop retrying (no logout)

#### Scenario: Cross-tab sync on token refresh
- **WHEN** a `storage` event fires where `isExpiryKey(e.key)` is true and `e.newValue` exists
- **THEN** the hook SHALL read the updated token and refresh token from localStorage
- **AND** update React state with the new values

#### Scenario: Cross-tab sync on logout
- **WHEN** a `storage` event fires where `isTokenKey(e.key)` is true and `e.newValue` is null
- **THEN** the hook SHALL set state to unauthenticated

#### Scenario: Timer cleanup on unmount
- **WHEN** the component unmounts or dependencies change
- **THEN** all active timers (refresh and retry) SHALL be cleared

### Requirement: useInactivity hook tracks user activity and shows modal
The `useInactivity(isAuthenticated, logout)` hook SHALL manage event listeners for user activity, detect inactivity after 20 minutes, and expose modal state.

#### Scenario: Activity event listeners registered when authenticated
- **WHEN** `isAuthenticated` is true
- **THEN** the hook SHALL register passive `mousedown`, `keydown`, `scroll`, and `touchstart` listeners on `document`
- **AND** update the last activity timestamp via `setLastActivity()` when triggered (debounced at 5 minutes)

#### Scenario: Inactivity detection
- **WHEN** the user has been inactive for 20 minutes (no activity events)
- **THEN** the hook SHALL set `showModal` to true (checked every 60 seconds)

#### Scenario: Continue resets activity
- **WHEN** `handleContinue` is called
- **THEN** the hook SHALL update the last activity timestamp to now via `setLastActivity()`
- **AND** set `showModal` to false

#### Scenario: Logout from inactivity modal
- **WHEN** `handleLogout` is called
- **THEN** the hook SHALL set `showModal` to false
- **AND** call the provided `logout` function

#### Scenario: Cleanup on unmount
- **WHEN** the component unmounts or `isAuthenticated` becomes false
- **THEN** all event listeners and the inactivity check interval SHALL be removed

### Requirement: logout uses clearAll instead of manual key removal
The `logout` function in `AuthProvider` SHALL call `clearAll()` from `lib/auth/tokenStorage` instead of individually removing each localStorage key.

#### Scenario: Logout clears state via clearAll
- **WHEN** `logout()` is called
- **THEN** it SHALL fire-and-forget a POST to `/api/auth/logout` for server-side revocation
- **AND** call `clearAll()` to remove all auth localStorage keys
- **AND** reset React state to unauthenticated

### Requirement: handleCallback uses setter functions
The `handleCallback` function in `AuthProvider` SHALL use `setToken()`, `setRefreshToken()`, `setTokenExpiry()`, and `setUser()` from `lib/auth/tokenStorage` instead of raw `localStorage.setItem()` calls.

#### Scenario: Callback stores tokens via setters
- **WHEN** `handleCallback(code)` receives a successful response
- **THEN** it SHALL call `setToken(data.token)`, `setUser(data.user)`, `setRefreshToken(data.refresh_token)`, and `setTokenExpiry(Date.now() + data.expires_in * 1000)`
- **AND** update React state to authenticated
