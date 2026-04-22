# stream-auth-token Specification

## Purpose
Provides Stream.io JWT token minting for authenticated users, enabling the frontend to connect to Stream channels for chat persistence.

## Requirements
### Requirement: Stream Token Minting Endpoint

The backend SHALL provide an endpoint that mints Stream.io JWT tokens for authenticated users.

- The endpoint SHALL be `GET /api/auth/stream-token`.
- The endpoint SHALL require a valid Bearer token (existing auth middleware).
- The endpoint SHALL use the authenticated user's `id` as the Stream user ID.
- The endpoint SHALL sign the JWT with the `STREAM_API_SECRET` environment variable.
- The response SHALL return `{ token: "<stream-jwt>" }` with status 200.

#### Scenario: Authenticated user requests Stream token

- **GIVEN** a user is authenticated with a valid Bearer token
- **WHEN** the user sends GET to `/api/auth/stream-token`
- **THEN** the backend SHALL return a Stream JWT token signed for that user's ID
- **THEN** the frontend SHALL use this token to connect to Stream via `client.connectUser()`

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request is sent to `/api/auth/stream-token` without a valid Bearer token
- **THEN** the backend SHALL return 401 Unauthorized

### Requirement: Stream Configuration

Stream.io credentials SHALL be sourced from environment variables and MUST differ between dev and production environments.

- The backend SHALL read `STREAM_API_KEY` and `STREAM_API_SECRET` from environment variables.
- In dev mode (`AUTH_MODE=dev`), the Stream token SHALL be minted for the dev user (`dev-user-001`).
- The frontend SHALL read `STREAM_API_KEY` from the Vite environment (`VITE_STREAM_API_KEY`).

#### Scenario: Backend loads Stream credentials on startup

- **GIVEN** `STREAM_API_KEY` and `STREAM_API_SECRET` are configured in the environment
- **WHEN** the backend starts
- **THEN** the backend SHALL use those values to sign Stream JWTs for all subsequent requests

#### Scenario: Dev mode token bound to dev user

- **GIVEN** the backend is running with `AUTH_MODE=dev`
- **WHEN** a request is made to `GET /api/auth/stream-token`
- **THEN** the returned token SHALL be minted for the Stream user ID `dev-user-001`

#### Scenario: Frontend reads public Stream key from Vite environment

- **GIVEN** `VITE_STREAM_API_KEY` is set in the frontend build environment
- **WHEN** the frontend bundles for deployment
- **THEN** the bundle SHALL include that key for client-side Stream connections
