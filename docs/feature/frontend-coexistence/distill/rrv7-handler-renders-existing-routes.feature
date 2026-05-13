# <!-- DES-ENFORCEMENT : exempt -->
# Walking skeleton — frontend-coexistence (MR-0 / Slice 1).
#
# Strategy: C (real local compose stack, skip-when-unavailable) per
# `distill/wave-decisions.md` DI-1.
#
# This skeleton proves the end-to-end SSR shell pass-through for MR-0:
# a browser request to `/` reaches `web-ssr` via nginx, the Hono process
# delegates to the RRv7 request handler, the library-mode route matches,
# and `web-ssr` returns the SPA shell HTML (a `<div id="root">` + the
# client `<Scripts>`) that hydrates into the same SPA the browser saw
# pre-MR-0. The skeleton answers Mandate-3's user-value question:
# "Can Maya open Dashboard Chat and see the app render?"
#
# It is NOT a layer-connectivity proof. The "Then" steps assert
# user-observable outcomes (200 text/html, HTML5 shape, no error page),
# not internal side effects (no "Hono received the request", no
# "nginx logged a proxy_pass").
#
# Driving port: the `reverse-proxy` ingress (host port 5173 in the
# local compose). The user's URL bar is the only entry point being
# tested.

@walking_skeleton @real-io @driving_port @slice-1
Feature: Maya opens Dashboard Chat after MR-0 ships and the app renders identically to pre-MR-0
  As Maya, a returning user of Dashboard Chat,
  I want the page to load the same way it always did after the frontend coexistence plumbing lands,
  So that the team can ship the RRv7 framework-mode substrate without me noticing any change.

  Background:
    Given the post-MR-0 compose topology is up — reverse-proxy + web-ssr + auth-proxy + agent + ui-state + api + redis are healthy
    And no route in `frontend/app/routes/` exports a server `loader` (MR-0 invariant: every route is library-mode)

  @adr-034 @dwd-8
  Scenario: A request to the root path is served as an SSR'd HTML shell that bootstraps the SPA
    When Maya opens her browser to the application root URL
    Then she receives an HTML document that contains the SPA mount point and the client bundle reference
    And the response status is 200
    And the response Content-Type is text/html
    And the response body does not contain a server-side error page or stack trace
    And the response body is a well-formed HTML5 document with a `<html>` root and a `<body>` element
