## Purpose

Describes how authenticated identity propagates across the app. On the frontend, auth is composed from small hooks (token state, inactivity, context), and on the backend, middleware derives identity from trusted proxy headers or a verified bearer token.

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

### Requirement: Backend auth context supports proxy-header-based identity
The backend `get_auth_user()` contextvar and `set_auth_user()` SHALL continue to function as before, but `AuthMiddleware` SHALL additionally support reading identity from trusted proxy headers when `TRUST_PROXY_HEADERS` is enabled.

#### Scenario: Middleware sets contextvar from proxy headers
- **WHEN** `TRUST_PROXY_HEADERS` is true and the request contains `X-User-Id` header
- **THEN** `AuthMiddleware` SHALL construct an `AuthUser` from the proxy headers and call `set_auth_user()`
- **AND** SHALL skip token verification via the auth provider

#### Scenario: Middleware falls back to token verification without proxy headers
- **WHEN** `TRUST_PROXY_HEADERS` is true but the request does not contain `X-User-Id` header
- **THEN** `AuthMiddleware` SHALL proceed with standard Bearer token verification via the auth provider
