Feature: Cross-service observability through consistent, correlatable logs
  As an on-call engineer, developer, or security reviewer
  I want every critical path to emit structured, correlatable logs with a logged reason on failure
  So that I can follow one user action end-to-end and audit every decision without finding silence or noise

  Background:
    Given all five runtime surfaces emit the shared ECS/OTel LogRecord envelope
    And a correlation id is minted at the auth-proxy ingress

  # --- Step 1 + 2: one id spans the stack (US-1, SJ-1) ---

  Scenario: An error response carries a correlation id
    When a request fails on any surface
    Then the error response includes a "correlation_id" field
    And the same "correlation_id" appears on the log lines of every service the request touched

  Scenario: The correlation id is propagated, not re-minted, downstream
    Given an inbound request already carries a correlation id header
    When the request traverses auth-proxy then backend or agent then ui-state
    Then every service's log lines for that request share the inbound correlation id
    And no service mints a second id for the same request

  # --- Step 4: audit every auth decision, never the credential (US-2, SJ-2) ---

  Scenario: A rejected JWT is logged with a reason and no token
    When auth-proxy rejects a JWT
    Then a WARN log names the rejection reason and the principal
    And the log line contains no token, cookie, or secret material

  Scenario: An M2M token mint and a PAT revocation are auditable
    When a client mints an M2M token and later a PAT is revoked
    Then an INFO audit line records each action with the client_id or principal_id
    And neither line contains the client secret or token value

  # --- Step 3: the happy path is visible and failures are never silent (US-3, US-4, US-5) ---

  Scenario: A chat turn is traceable from entry to completion
    When the agent handles a POST /chat that streams to completion
    Then an INFO log marks the turn start and an INFO log marks the turn completion
    And tool dispatch and the model finish reason are visible at DEBUG

  Scenario: A denied backend request is logged, not silently mapped to HTTP
    When a backend use case raises a DomainException that denies access
    Then a log line records the denial outcome with org_id and user_id
    And the request lifecycle line records method, path, status, and latency

  Scenario: A best-effort failure is logged instead of swallowed
    Given a ui-state Redis append fails
    When the best-effort path handles the error
    Then a WARN or ERROR log records the failure with context
    And there are zero empty catch blocks on catalogued critical paths

  # --- Step 6: SSR/BFF gateway failures leave a trace (US-6, SJ-6) ---

  Scenario: A failed /bff relay is logged server-side
    When the ui SSR /bff/chat relay receives a non-2xx upstream response or throws
    Then the structured logger records the failure with the request path and status
    And the SSR render error path uses the structured logger, not a bare console.error

  # --- Step 5 + safety: runtime verbosity and redaction (US-7, SJ-7) ---

  Scenario: Verbosity is raised at runtime without a redeploy
    Given a service running at the default INFO level
    When LOG_LEVEL is set to debug and the service re-reads its config
    Then DEBUG log lines appear
    And the default level remains INFO when LOG_LEVEL is unset

  Scenario: Sensitive fields are never serialized
    When any log call includes attributes containing an authorization header, a cookie, a token, a secret, a password, or a raw email
    Then the serialized log line redacts those values
    And a regression test asserts the redaction holds

  # --- coexistence guardrail (US-7) ---

  Scenario: Existing KPI and startup lines are preserved
    Given auth-proxy already emits KPI-event JSON lines and a startup image-identity line
    When the structured logger is introduced
    Then the existing KPI-event JSON lines and startup identity lines still appear unchanged
