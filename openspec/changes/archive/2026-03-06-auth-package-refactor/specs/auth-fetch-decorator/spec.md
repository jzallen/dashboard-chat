## MODIFIED Requirements

### Requirement: Auth utilities located in lib/auth package
All auth-related business logic utilities (token storage getters/setters, header generation, logout, token refresh, decorators) SHALL be exported from `lib/auth/`. React-specific auth code (`AuthProvider`, `useAuth`) SHALL be exported from `lib/ui/context/AuthContext/`. The `lib/api/` package SHALL NOT contain auth logic.

#### Scenario: Token storage in auth package
- **WHEN** code needs to access auth token storage functions (`getToken`, `setToken`, `getRefreshToken`, `setRefreshToken`, `getTokenExpiry`, `setTokenExpiry`, `getLastActivity`, `setLastActivity`, `getUser`, `setUser`, `clearAll`, `isTokenKey`, `isExpiryKey`) or utility functions (`getAuthHeaders`, `hardLogout`)
- **THEN** these SHALL be importable from `lib/auth/tokenStorage`

#### Scenario: Token refresh in auth package
- **WHEN** code needs token refresh logic (`ensureFreshToken`, `_resetRefreshState`)
- **THEN** these SHALL be importable from `lib/auth/tokenRefresh`

#### Scenario: Decorators in auth package
- **WHEN** code needs auth-aware fetch (`withAuth`, `withPreAuth`)
- **THEN** these SHALL be importable from `lib/auth/withAuth`

#### Scenario: React auth context in ui context package
- **WHEN** React components need `AuthProvider` or `useAuth`
- **THEN** these SHALL be importable from `lib/ui/context/AuthContext`
- **AND** they SHALL NOT be available from `lib/auth`

#### Scenario: Barrel export from auth index
- **WHEN** code imports from `lib/auth`
- **THEN** all public auth business logic symbols SHALL be available via the barrel export in `lib/auth/index.ts`
- **AND** React-specific symbols (`AuthProvider`, `useAuth`) SHALL NOT be in the barrel
