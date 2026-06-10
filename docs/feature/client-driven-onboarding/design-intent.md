# client-driven-onboarding — Design Intent (user-ratified target)

**Status:** Ratified direction (user, 2026-06-10) — the DESIGN wave formalizes the
contracts and pins the open points; it does NOT re-litigate the boundary assignments.
**Supersedes (in part):** the server-side-actor write model of ADR-041 (the onboarding
machine's `createOrg`/`getUserOrg` invokes) and ADR-041's context-map line assigning
"org creation" to the backend Org/Project context.
**Relationship:** ADR-016 (auth-proxy sole ingress — this REMOVES ui-state's documented
direct-to-backend bypass), ADR-044/046 (the chat-app `/state` surface stays; the
onboarding region's EVENT VOCABULARY changes from actor-driven to client-reported
outcomes), org-onboarding (shipped 2026-06-10 — this reworks its write path, not its
surfaces), ui-cookie-session (the cookie session this rides on).

## Why (evidence from 2026-06-10)

1. **AUTH_MODE split-brain**: auth-proxy and backend independently read AUTH_MODE;
   docker-compose.override.yml pins auth-proxy to dev but not api, so a stray `.env`
   put the backend in workos mode while auth-proxy ran dev → org-create hit the real
   WorkOS API with a fixture user id → 404 → 502 → `partial-setup` dead-end.
2. **The backend's ONLY auth_mode read** is the org-create dispatch
   (`create_organization.py:72`); its only WorkOS credential use is `_create_workos_org`.
3. **ui-state calls the backend directly** (`${backendUrl}`, dev fixture identity
   headers), bypassing auth-proxy — an ADR-016 violation; and machine-internal I/O
   produced real fragility (an event sent to a settled onboarding child crashes the
   whole ui-state process; `partial-setup` is terminal-in-practice with no retry).
4. **Two write philosophies coexist**: the ui/ catalog owns optimistic write-through
   for every other mutation; onboarding was the only flow where a server-side machine
   performed writes.
5. **The dev sign-in button renders unconditionally** — a production user must never
   see a dev affordance; the CSR client currently has no way to learn the mode.

## Boundary assignments (FIXED — design to these)

| Component | Owns |
|---|---|
| **auth-proxy** | Auth, AUTH_MODE (sole reader), ALL WorkOS interaction: sign-in sequence, token mint/verify/reissue, and IdP org provisioning via interception of the org-create route. Exposes mode discovery to the client. |
| **backend** | Pure resource store. No AUTH_MODE, no WorkOS credentials, no IdP awareness. Trusts auth-proxy's identity headers. Org create = local row (+ name uniqueness + created_by stamp). |
| **client (ui/)** | Drives the flow and owns ALL writes (consistent with the catalog write-through pattern). Probes, posts, reports outcomes to ui-state. |
| **ui-state** | Pure presentation-state coordinator: receives client-reported outcome events, transitions synchronously, returns state. NO backend calls, NO WorkOS calls, no credentials, no network egress. |

## The target flow (ordered, user-stated)

### Phase A — mode discovery & sign-in
1. Client hits the app; reverse-proxy forwards the client to auth-proxy first.
2. Client asks auth-proxy for the sign-in entry:
   - workos mode → auth-proxy returns the WorkOS sign-in redirect (no dev affordance).
   - dev mode → the response identifies a dev service; client renders the dev
     sign-in button.
3. On sign-in success (WorkOS callback completing, or dev button clicked) the client
   requests the token from auth-proxy (session minted/set — cookie per ui-cookie-session).

### Phase B — onboarding bootstrap
4. Authenticated, the client engages ui-state to start login-onboarding.
5. Client asks auth-proxy whether the user's org exists (the sparse existence probe,
   through the normal ingress).
6. Client forwards the answer to ui-state as an event; ui-state transitions and
   returns the new state.
7. State == needs_org → client routes to the OnboardingRoute.

### Phase C — org creation
8. User enters the org name; client POSTs the org to the backend (through auth-proxy,
   like every request).
9. Auth-proxy validates the token; because the route is the org-create POST, in
   workos mode it FIRST updates WorkOS with the new org, THEN forwards the request to
   the backend as normal. (Dev mode: straight forward.)
10. Backend persists the org to its DB — pure resource write.
11. Client receives org-create success and updates ui-state with the outcome.

### Phase D — default project & app entry
12. Client AUTOMATICALLY POSTs the Default Project to the backend (no user input;
    project naming/editing is a later feature).
13. Client updates ui-state with the project outcome (success or fail).
14. On success ui-state returns the engaged state → client routes into the app-shell.

## Open points the DESIGN pass must pin (the actual design work)

- **(a) Token reissue:** in workos mode the session must pick up the new org claim
  after step 9–10 — presumably auth-proxy Set-Cookies the refreshed token on the
  org-create response (the existing post-response-reissue seam, cookie-ised). Dev mode
  is covered by DEV_NO_ORG DB resolution. Define the exact mechanism + client behavior.
- **(b) Org id:** today the WorkOS org id IS the local org id. The interception must
  carry the WorkOS-created id into the forwarded backend write (header? body rewrite?).
  Define the contract, and the dev-mode id source.
- **(c) Failure paths:** name-taken (409); WorkOS-created-but-backend-persist-failed
  (and the reverse — consider pre-checking name with the backend BEFORE the WorkOS
  create so a 409 cannot orphan an IdP org); default-project failure after org
  success. Each needs a defined client→ui-state outcome event so the machine can
  represent retry/partial states (no more terminal `partial-setup` dead-ends; the
  crash-on-event-to-settled-child bug must also be addressed by the new event design).
- **(d) Mode-discovery contract:** the exact endpoint/response (e.g. GET
  /api/auth/config → {mode} or mode folded into the login response), and how the
  reverse-proxy "forwards the client to auth-proxy first."
- **(e) ui-state event vocabulary:** the outcome-event schema for the onboarding +
  project-context regions (org_exists_reported / org_created / org_create_failed /
  default_project_created / ... — names TBD), what happens to the retired invokes
  (getUserOrg, createOrg, createProject, the WorkOS re-verify), and the migration path
  for the shipped org-onboarding surfaces + acceptance suite.
- **(f) Engaged-state contract:** what exactly flips the chat-app to engaged under
  client-reported project success (today it is project_selected from the
  project-context machine's own invoke).

## Non-goals

- Project naming/editing during onboarding (later feature; default project is
  auto-created with a default name).
- Member invites, multi-org.
- Changing the /state transport (ADR-046 StateProxy stays as-is).
