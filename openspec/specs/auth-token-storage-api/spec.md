# auth-token-storage-api Specification

## Purpose
Encapsulates all localStorage auth key access behind a getter/setter API, keeping raw key constants private and providing predicate functions for storage event matching.

## Requirements

### Requirement: tokenStorage exposes getter/setter API for all auth keys
The `lib/auth/tokenStorage` module SHALL export getter/setter functions for each auth localStorage key instead of raw key constants. The localStorage key names SHALL be private module-level constants.

#### Scenario: Token getter and setter
- **WHEN** code needs to read the access token
- **THEN** it SHALL call `getToken()` which returns `string | null`
- **AND** to write a token it SHALL call `setToken(token: string)`

#### Scenario: Refresh token getter and setter
- **WHEN** code needs to read the refresh token
- **THEN** it SHALL call `getRefreshToken()` which returns `string | null`
- **AND** to write a refresh token it SHALL call `setRefreshToken(token: string)`

#### Scenario: Token expiry getter and setter
- **WHEN** code needs to read the token expiry timestamp
- **THEN** it SHALL call `getTokenExpiry()` which returns `number | null` (Unix ms timestamp)
- **AND** to write the expiry it SHALL call `setTokenExpiry(expiresAt: number)`

#### Scenario: Activity timestamp getter and setter
- **WHEN** code needs to read the last activity timestamp
- **THEN** it SHALL call `getLastActivity()` which returns `number | null`
- **AND** to write the activity timestamp it SHALL call `setLastActivity(timestamp: number)`

#### Scenario: User getter and setter
- **WHEN** code needs to read the stored auth user
- **THEN** it SHALL call `getUser()` which returns `AuthUser | null` (JSON-parsed from localStorage)
- **AND** to write the user it SHALL call `setUser(user: AuthUser)` (JSON-serialized to localStorage)

### Requirement: tokenStorage exposes key predicate functions for storage event matching
The module SHALL export predicate functions that allow consumers to check if a `StorageEvent.key` matches a specific auth key without knowing the raw key name.

#### Scenario: Token key predicate
- **WHEN** a `StorageEvent` is received and code needs to check if the event's key is the access token key
- **THEN** it SHALL call `isTokenKey(event.key)` which returns `boolean`

#### Scenario: Expiry key predicate
- **WHEN** a `StorageEvent` is received and code needs to check if the event's key is the token expiry key
- **THEN** it SHALL call `isExpiryKey(event.key)` which returns `boolean`

### Requirement: tokenStorage exposes clearAll for bulk cleanup
The module SHALL export a `clearAll()` function that removes all auth-related keys from localStorage without redirecting.

#### Scenario: clearAll removes all auth keys
- **WHEN** `clearAll()` is called
- **THEN** it SHALL remove the access token, refresh token, token expiry, activity timestamp, and user keys from localStorage
- **AND** it SHALL NOT redirect the browser or modify `window.location`

#### Scenario: hardLogout delegates to clearAll
- **WHEN** `hardLogout()` is called
- **THEN** it SHALL call `clearAll()` to remove all auth keys
- **AND** then redirect to `/login` via `window.location.href`

### Requirement: Raw key constants are not exported
The localStorage key names (`auth_token`, `auth_refresh_token`, `auth_token_expires_at`, `last_activity_ts`, `auth_user`) SHALL be private module-level constants, not exported.

#### Scenario: No constant exports from tokenStorage
- **WHEN** code imports from `lib/auth/tokenStorage`
- **THEN** `TOKEN_KEY`, `REFRESH_TOKEN_KEY`, `EXPIRES_AT_KEY`, `ACTIVITY_KEY` SHALL NOT be available as named exports
