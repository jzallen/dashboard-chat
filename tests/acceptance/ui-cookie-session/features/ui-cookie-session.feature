# Scenario SSOT (business language) for the ui-cookie-session feature.
#
# Driving port for every scenario: the auth-proxy HTTP surface — the credential
# is established, carried, read back, and revoked there. Technical detail (HTTP,
# Set-Cookie attributes, Authorization vs Cookie header) lives in the driver /
# step layer, not here.
#
# Scope: a credential STORAGE + TRANSPORT migration only — the token format is
# unchanged (same JWT). No change to who can sign in or what claims a token
# carries; frontend/ stays on its existing localStorage path (untouched).
#
# Traceability: each scenario maps to a DELIVER slice (C1–C4) and to a
# test_*.py implementation. See ../../../docs/feature/ui-cookie-session/distill/roadmap.json
# and ../../../docs/feature/ui-cookie-session/design/delta-and-decisions.md.

Feature: Cookie-based session for the web client
  As the web client whose token must not be readable by injected scripts,
  I want my credential established, carried, and revoked as an httpOnly cookie session,
  so that a script cannot steal the token and the credential can ride requests that
  cannot set headers — without breaking the existing header-based clients.

  Background:
    Given the local service stack is running in dev mode

  @walking_skeleton @real_io @happy_path @c1_authproxy_cookies @c2_authproxy_me_logout
  Scenario: A person signs in, works on their cookie session, sees their identity, and signs out
    When a person signs in
    Then their session credential is established as a protected cookie
    And a browser-readable sign-in flag is set
    And the sign-in response still carries the legacy token for the existing web client
    When they make an authenticated request carried only by their session cookie
    Then the request is allowed
    And their identity can be read back from the session
    When they sign out
    Then their session credential and sign-in flag are revoked
    And a request carrying no credential is refused

  @real_io @happy_path @c1_authproxy_cookies @pending
  Scenario: Signing in establishes a protected cookie and keeps the legacy token in the body
    When a person signs in
    Then their session credential is a cookie that scripts cannot read
    And the protected cookie is restricted to first-party use and the whole site
    And the protected cookie expires with the token
    And a separate browser-readable sign-in flag is set that carries no secret
    And the sign-in response body still carries the legacy token for the existing web client

  @real_io @happy_path @c1_authproxy_cookies @pending
  Scenario: An authenticated request is allowed when carried only by the session cookie
    Given a person has signed in
    When they make an authenticated request carried only by their session cookie, with no header credential
    Then the request is allowed

  @real_io @regression @guard @c1_authproxy_cookies
  Scenario: A header credential takes precedence over the session cookie
    Given a person has signed in
    When they make an authenticated request carrying a valid header credential alongside an invalid session cookie
    Then the request is allowed because the header credential is honoured first

  @real_io @error_path @guard @c1_authproxy_cookies
  Scenario: An invalid header credential is not rescued by a valid session cookie
    Given a person has signed in
    When they make an authenticated request carrying an invalid header credential alongside their valid session cookie
    Then the request is refused, because a present header credential is honoured first and its failure is final

  @real_io @happy_path @c2_authproxy_me_logout @pending
  Scenario: The signed-in person's identity can be read back from the session cookie
    Given a person has signed in
    When they ask who they are, carried only by their session cookie
    Then their identity is returned

  @real_io @error_path @guard @c2_authproxy_me_logout
  Scenario: Asking who they are with no credential is refused
    When someone asks who they are carrying no credential at all
    Then the request is refused as unauthenticated

  @real_io @error_path @c2_authproxy_me_logout @pending
  Scenario: Signing out revokes both the session credential and the sign-in flag
    Given a person has signed in
    When they sign out, carried by their session cookie
    Then their session credential is revoked
    And their sign-in flag is revoked

  @real_io @regression @guard
  Scenario: An existing header-based client still authenticates unchanged
    Given a token held by an existing header-based client
    When it makes an authenticated request carrying only that token in the header
    Then the request is allowed

  @real_io @error_path @guard @c1_authproxy_cookies
  Scenario: A request bearing an invalid session cookie and no header is refused
    When someone makes an authenticated request carrying only an unverifiable session cookie
    Then the request is refused as unauthenticated
