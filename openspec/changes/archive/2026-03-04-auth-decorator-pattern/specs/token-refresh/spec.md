## MODIFIED Requirements

### Requirement: Both client.ts and fetchUtils.ts use shared interceptor
All frontend API clients SHALL use the `withAuth` decorator (from `lib/auth/withAuth.ts`) which encapsulates the shared coalesced refresh interceptor. The decorator internally delegates to `ensureFreshToken()` in `lib/auth/tokenRefresh.ts`, ensuring all API clients participate in the same refresh promise coalescence. Direct calls to `withAuthRetry()` or `getAuthHeaders()` from API client code SHALL NOT occur — these are internal implementation details of the decorator.

#### Scenario: Consistent 401 handling across API modules
- **WHEN** a 401 is received by either the backend API client (`client.ts`) or the chat worker client (`chatClient.ts`)
- **THEN** both SHALL handle it through their respective `withAuth(fetch)` decorator instance
- **AND** both decorator instances SHALL delegate to the same `ensureFreshToken()` function
- **AND** both SHALL participate in the same refresh promise coalescence (single in-flight refresh request)

#### Scenario: Backend API client no longer calls withAuthRetry directly
- **WHEN** `client.ts` makes an HTTP request
- **THEN** it SHALL use `withAuth(fetch)` which internally handles 401 retry
- **AND** it SHALL NOT import or call `withAuthRetry()` directly

#### Scenario: Chat worker client no longer calls getAuthHeaders directly
- **WHEN** `chatClient.ts` makes an HTTP request
- **THEN** it SHALL use `withAuth(fetch)` or `withPreAuth(fetch)` which internally injects auth headers
- **AND** it SHALL NOT import or call `getAuthHeaders()` directly
