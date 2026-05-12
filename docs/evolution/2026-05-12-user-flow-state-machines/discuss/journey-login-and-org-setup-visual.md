# Journey: Login + Org Setup — Visual

> **Wave**: DISCUSS (`user-flow-state-machines`)
> **Persona**: **Maya Chen** — new contributor, WorkOS-managed identity, no org in Dashboard Chat yet
> **Goal**: Reach a state where the app knows who Maya is and which org she is in, with that state reflected identically in the FE shell, the chat session, and any headless harness watching the flow.

This is the deep-dive flow's visual artifact: ASCII flow with emotional
annotations, screen mockups for each state, and the integration
checkpoints that the state-machine layer must enforce.

---

## Emotional arc

```
Curious           Mildly anxious        Confident-and-oriented
   |                    |                         |
   v                    v                         v
[start]  -->  [callback round-trip]  -->  [app shell, org named, my name top-right]
                       ^
                       |
            (the friction we just lived through:
             JWKS warm-up + dev-token shape +
             cookie roundtrip — currently invisible
             to the user; we want it surfaced
             as "checking your identity..." with
             a visible recovery path on failure)
```

Target: confidence builds progressively. No jarring transition between
"the redirect" and "the app." If the round-trip fails, the user lands
on a screen that explains what happened and what to do — not on a
blank page or a raw error.

---

## State machine (server-owned)

```
                                +-------------------+
                                | anonymous         |
                                | (no session)      |
                                +---------+---------+
                                          |
                            click "Sign in" / token absent
                                          |
                                          v
                                +-------------------+
                                | authenticating    | <-- emit `auth_started`
                                | (WorkOS round-    |     UI: "Checking your identity..."
                                | trip in flight)   |
                                +---------+---------+
                                          |
                              callback succeeds
                                          |
                                          v
                            +-------------+-------------+
                            |                           |
              user has org                       user has no org
                            |                           |
                            v                           v
              +-------------------+        +-------------------------+
              | ready             |        | authenticated_no_org    | <-- emit `org_required`
              | (shell rendered,  |        | (CreateOrg form visible)|
              | session selected) |        +-----------+-------------+
              +---------+---------+                    |
                        ^                  user submits valid org name
                        |                              |
                        |                              v
                        |                  +-------------------------+
                        |                  | creating_org            | <-- emit `org_creation_started`
                        |                  | (POST /api/orgs, then   |     UI: progress, disable submit
                        |                  |  bind JWT to new org)   |
                        |                  +-----------+-------------+
                        |                              |
                        +------------------------------+
                                  org created;
                                  JWT re-issued
                                  with org claim
                                          ^
                                          |
                                  +-------+--------+
                                  | error_         |
                                  | recoverable    | <-- emit `auth_recoverable_error`
                                  | (JWKS down,    |     UI: "Could not verify your
                                  |  network blip, |          identity right now."
                                  |  dev-token     |          + "Try again" + diagnostic
                                  |  shape drift)  |             reference (correlation id)
                                  +-------+--------+
                                          |
                            transient error during auth
                                          |
                                          +------------ (retry returns to `authenticating`)


                                  +----------------+
                                  | expired_token  | <-- emit `token_expired`
                                  | (any state can |     UI: non-blocking banner; chat
                                  |  transition    |          requests freeze; recovery
                                  |  here when     |          flow re-runs the round-trip
                                  |  JWT exp hits) |          silently when possible
                                  +-------+--------+
                                          |
                                  silent re-auth ok
                                          |
                                          v
                                    (back to previous state)
```

The user experiences only the **top half** (anonymous → authenticating
→ ready). The bottom half (`error_recoverable`, `expired_token`,
`creating_org`) exists to make the **non-happy paths** behave
predictably AND to make the **TS harness** able to drive every
transition.

---

## Step-by-step visual

### Step 1: Landing (state: `anonymous`)

```
+-- maya.dashboard-chat.app ----------------------------------------+
|                                                                  |
|                      Dashboard Chat                              |
|                                                                  |
|              Talk to your tables. Ship dbt.                      |
|                                                                  |
|                  +-------------------+                           |
|                  |  Sign in          |                           |
|                  +-------------------+                           |
|                                                                  |
|              Use your work account through WorkOS                |
|                                                                  |
+------------------------------------------------------------------+
```

**Emotional state**: curious. No anxiety yet — the page is honest
about what it does.

**Shared artifacts on this screen**: `${product.name}`,
`${idp.display_name}` ("WorkOS" hard-coded today; should source from
`AUTH_MODE` config).

---

### Step 2: Round-trip (state: `authenticating`)

```
+-- maya.dashboard-chat.app/auth/callback?code=... ----------------+
|                                                                  |
|             +-----------------------------+                      |
|             |  Checking your identity...  |                      |
|             |                             |                      |
|             |  This usually takes about   |                      |
|             |  two seconds.               |                      |
|             |                             |                      |
|             |  [-----------=====-]  ~75%  |                      |
|             +-----------------------------+                      |
|                                                                  |
+------------------------------------------------------------------+
```

**Emotional state**: brief anxiety, contained by visible progress
+ honest copy. Reassuring tone (per `ux-emotional-design`).

**Shared artifacts on this screen**: none user-visible. Internally:
`${correlation_id}` (logged so error states can show it).

**Currently invisible (today's friction)**: the JWKS warm-up race +
dev-token shape mismatch + cookie round-trip. Today this state is
either an undisplayed instant transition (success path) or a
**blank** error screen (failure). We want it surfaced both ways.

---

### Step 3a: Org setup (state: `authenticated_no_org`)

```
+-- maya.dashboard-chat.app/welcome -------------------------------+
|  Logged in as maya.chen@acme-data.example                        |
|                                                                  |
|                 Welcome to Dashboard Chat                        |
|                                                                  |
|     Let's set up your organization. This is the workspace        |
|     your teammates will share.                                   |
|                                                                  |
|     +----------------------------------+                         |
|     | Organization name                |                         |
|     | +-------------------------+      |                         |
|     | | Acme Data               |      |                         |
|     | +-------------------------+      |                         |
|     +----------------------------------+                         |
|                                                                  |
|                  +------------------+                            |
|                  |  Create          |                            |
|                  +------------------+                            |
|                                                                  |
|  Need to join an existing org? Ask your admin to invite you.     |
|                                                                  |
+------------------------------------------------------------------+
```

**Emotional state**: oriented but mid-task. The user sees her email
already filled (it came back from WorkOS — Maya recognizes it,
reducing anxiety). The "Need to join an existing org?" footer
removes the panic of "did I just create a duplicate org?"

**Shared artifacts on this screen**:

* `${user.email}` — source: WorkOS callback profile.
* `${user.display_name}` — source: WorkOS callback profile (not yet
  on screen here, but consumed by step 4).

---

### Step 3b: Creating org (state: `creating_org`)

```
+-- maya.dashboard-chat.app/welcome -------------------------------+
|                                                                  |
|     +----------------------------------+                         |
|     | Organization name                |                         |
|     | +-------------------------+      |                         |
|     | | Acme Data               |  []  |  <- input disabled      |
|     | +-------------------------+      |                         |
|     +----------------------------------+                         |
|                                                                  |
|                  +------------------+                            |
|                  |  Creating...     |  <- spinner, button disabled|
|                  +------------------+                            |
|                                                                  |
|  Setting up your workspace. We're issuing your access token...   |
|                                                                  |
+------------------------------------------------------------------+
```

**Emotional state**: brief anxiety again — the JWT is being re-issued
with the new org claim, which is the second-most-likely failure point
in this flow.

---

### Step 4: App shell (state: `ready`)

```
+-- maya.dashboard-chat.app ----------------------------------------+
| [Acme Data]   Projects    Sessions    Datasets    [M] Maya Chen ▾ |
+-------------------------------------------------------------------+
| Side Nav         |  Main pane                                     |
|                  |                                                |
|  [+] Project     |   No projects yet. Create your first one to    |
|                  |   start chatting with your data.               |
|                  |                                                |
|                  |        +--------------------+                  |
|                  |        |  Create project    |                  |
|                  |        +--------------------+                  |
|                  |                                                |
+-------------------------------------------------------------------+
```

**Emotional state**: confident-and-oriented. Two pieces of identity
state are visible: the org chip on the top-left
(`${org.name}` = "Acme Data") and the user chip on the top-right
(`${user.display_name}` = "Maya Chen"). Both come from the **same
server-owned flow state**, not from separate React state slices —
that's the architectural promise this feature realizes.

**Shared artifacts on this screen**:

* `${org.name}` — source: server-owned `login-and-org-setup` machine,
  state.org.name field.
* `${user.display_name}` — source: same machine, state.user.display_name.
* `${session.current}` — source: same machine; the post-`ready`
  transition pre-creates a first chat session and stashes its id
  here. The transition into the next flow (`project-and-session-mgmt`)
  reads from here.

---

### Step 5: Error path (state: `error_recoverable`)

```
+-- maya.dashboard-chat.app/auth/callback?code=... ----------------+
|                                                                  |
|     +-----------------------------------+                        |
|     |  We could not verify your identity|                        |
|     |  right now.                       |                        |
|     |                                   |                        |
|     |  This is usually a brief network  |                        |
|     |  issue and resolves with a retry. |                        |
|     |                                   |                        |
|     |       +-----------------+         |                        |
|     |       |  Try again      |         |                        |
|     |       +-----------------+         |                        |
|     |                                   |                        |
|     |  If it keeps happening, share     |                        |
|     |  this reference with support:     |                        |
|     |  R-7a4f-901c                      |  <- ${correlation_id}  |
|     +-----------------------------------+                        |
|                                                                  |
+------------------------------------------------------------------+
```

**Emotional state**: not blamed, given a path forward, given a
reference number so they can show support exactly what failed. (The
correlation id is also what the TS harness asserts on when
reproducing the failure path.)

**Recovery semantics**: clicking "Try again" emits `auth_retry`,
which transitions back to `authenticating`. Three failed retries
escalate to a non-recoverable error state with a "contact support"
CTA. (Out of scope for the DISCUSS deep-dive; named for completeness.)

---

### Step 6: Token expiry mid-session (state: `expired_token`)

```
+-- maya.dashboard-chat.app/projects/acme-revenue-2026 ------------+
| [Acme Data]   Projects ... [M] Maya Chen ▾                       |
+-------------------------------------------------------------------+
| Side Nav         |  +-- Session: Revenue Q1 -------------------+  |
|                  |  |                                          |  |
|  [P] Acme        |  |  > what's the average rev by region      |  |
|      Revenue     |  |                                          |  |
|      2026        |  |  ! Refreshing your session...            |  |
|                  |  |                                          |  |
|                  |  +------------------------------------------+  |
+-------------------------------------------------------------------+
```

**Emotional state**: barely-conscious — the banner is non-blocking;
the chat input is briefly disabled (~1-2 seconds) while the silent
re-auth runs. On success, the banner clears and the in-flight request
is replayed. On failure, the banner upgrades to the
`error_recoverable` mockup.

**Why it matters for the architecture**: today, token expiry is a
React-level concern handled inconsistently. With the server-owned
machine, the worker (which sees 401s first) can emit `token_expired`
into the directive log, the FE applies the banner, and **every other
flow's machine freezes its mutations** until `authenticating` resolves.

---

## Integration checkpoints

These are the points the state-machine layer must enforce — what must
be true at the boundary between two steps:

* **anonymous → authenticating**: A `correlation_id` is minted and
  attached to the auth attempt. The TS harness reads it from the
  state machine's emitted `auth_started` event to drive concurrent
  assertions.
* **authenticating → ready**: The JWT carries an `org_id` claim
  matching `state.org.id`. Diverging values is a failed transition
  (not a silent shrug).
* **authenticated_no_org → creating_org**: The supplied org name is
  validated server-side (length, character set, uniqueness within
  the user's tenant). Validation errors transition back to
  `authenticated_no_org` with the form re-displaying the error
  alongside the input.
* **creating_org → ready**: The JWT is re-issued (because the new
  org id must be in the claim). The FE drops the old JWT atomically
  and re-keys any in-flight TanStack Query subscriptions.
* **any → expired_token**: The 401 that triggers the transition
  carries the same `correlation_id` as the original request, so the
  TS harness can match the 401 to the originating turn.
* **expired_token → previous**: Silent re-auth is attempted exactly
  once before surfacing UI. The harness can disable silent re-auth
  via a flag for tests of the visible recovery path.

---

## Shared artifacts (this journey)

| Artifact | Source of truth | Consumers (this journey) | Cross-journey consumers |
|----------|-----------------|--------------------------|-------------------------|
| `${user.email}` | WorkOS callback profile, materialized into machine state | Step 3a header | Project mgmt, dbt export download metadata |
| `${user.display_name}` | Same | Step 4 user chip, Step 6 user chip | Every flow's app shell |
| `${org.name}` | Machine state (post `creating_org` or post-callback if user has org) | Step 4 org chip, Step 6 org chip | Every flow's app shell, project tree heading |
| `${org.id}` | JWT `org_id` claim, derived from machine state | Internal — JWT signing/verification | Every backend write (multi-tenant scoping) |
| `${correlation_id}` | Minted at `authenticating` entry, threaded through every emitted event in this attempt | Step 2 (logged), Step 5 (visible to user) | TS harness assertions; backend logs |
| `${session.current}` | Machine state, set at `ready` entry by pre-creating a first session | Step 4 transition to project mgmt | Project + session mgmt flow's machine reads this |

Full registry: see `shared-artifacts-registry.md`.

---

## Failure modes (for DISTILL → acceptance designer)

This deep-dive surfaces five named failure modes the acceptance
designer should produce explicit Gherkin scenarios for:

1. **WorkOS callback returns no profile** (corrupt code, IdP outage).
   Transitions to `error_recoverable` with correlation id.
2. **Backend JWKS not warm**. Symptom we just lived through:
   sub-second JWKS-endpoint cold-start, JWT verification fails on the
   worker side immediately after auth-proxy mints. Surfaces as a
   transient `error_recoverable`; harness should be able to drive
   this with a forced JWKS reset.
3. **Org name validation failure** (duplicate, illegal chars). Stays
   in `authenticated_no_org` with inline form error.
4. **Org creation succeeds but JWT re-issue fails**. The org row
   exists; the user's token does not yet carry the claim. The
   machine must clean up OR retry the JWT re-issue, never leave the
   user with an org they cannot access.
5. **Token expires mid-chat-turn**. The chat turn currently in flight
   freezes; on silent re-auth success it replays; on silent re-auth
   failure the user lands in `error_recoverable` with the
   correlation id of the original chat turn (not the auth attempt).

---

## Why this flow earns the deep-dive

Three signals converged:

1. **Recent debugging cost.** ~1 hour spent reconciling
   `AUTH_MODE=dev` token shape, JWKS warm-up race, and cookie
   roundtrip. Every minute of that was state that *should have lived
   in one machine*.
2. **Precondition density.** All seven other flows assume the
   `ready` state. Getting this flow's machine right means every
   subsequent flow's machine has a clean entry contract.
3. **Pattern-demonstration purity.** The flow has all four state
   types this feature must support:
   - durable state (org_id in JWT claim)
   - ephemeral state (correlation_id)
   - cross-flow state (token expiry that freezes all other machines)
   - error-recovery state (correlation-id-keyed UI)

If the state-machine layer's design can handle this flow cleanly,
the other six will mostly fall out.
