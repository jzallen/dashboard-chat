# ui-cookie-session — DISTILL wave decisions

## Prior-wave reading (enforcement checklist)

- `+` docs/product/architecture/brief.md (no `ui-cookie-session` section — DESIGN was
  skipped; `design/delta-and-decisions.md` is the bridge SSOT)
- `+` docs/product/journeys/login-and-org-setup.yaml (J-001; notes `cookie_blocked`
  as a known failure mode — corroborates the cookie direction)
- `+` docs/product/jobs.yaml
- `-` docs/product/kpi-contracts.yaml (not found — soft gate; proceed)
- `-` docs/feature/ui-cookie-session/discuss/* (not found — net-new feature)
- `-` docs/feature/ui-cookie-session/design/* — only the DISTILL-authored bridge
  (`delta-and-decisions.md`) exists; no upstream DESIGN artifacts
- `-` docs/feature/ui-cookie-session/devops/* (not found — using default matrix)
- `+` tests/acceptance/org-onboarding/* (convention template: API-level httpx vs the
  dev compose stack, skip-when-down / RED-when-up-and-unbuilt)
- `+` auth-proxy/app.ts, auth-proxy/lib/auth.ts, ui/app/auth/*, ui/app/catalog/* (ground
  truth verified against decisions D1–D9)

## DWD-1 — Reconciliation result: PASS (0 contradictions)

The decisions D1–D9 in `design/delta-and-decisions.md` were checked against the only
prior-wave artifacts that touch this area:

- **Login journey J-001** lists `cookie_blocked` ("Browser blocks third-party
  cookies; session cookie does not round-trip") as a failure mode → it already
  anticipates a cookie-based session. No contradiction; D1's `SameSite=Lax`,
  host-only, same-origin cookie is *first*-party, sidestepping the third-party-cookie
  failure entirely.
- **ADR-016** (auth-proxy is the token SSOT + sole backend ingress) — the cookie is
  set and read *only* at the auth-proxy, preserving the SSOT. No contradiction.
- **D2** (keep the callback body token) is the explicit correction of the original
  scoping note that said "remove it"; removing it would break `frontend/`, which is
  out of scope this sprint (D9). Recorded as resolved, not a contradiction.

No blocking contradictions. Scenario writing proceeds.

## DWD-2 — Walking Skeleton strategy: **C (real local / `@real_io`)**

Auto-detect → the feature's behavior is HTTP + cookies across the real auth-proxy
(no costly external in the dev target; WorkOS is faked in dev). Confirmed C, matching
the sibling `org-onboarding` suite. Every scenario is `@real_io` against the local
compose stack (reverse-proxy → auth-proxy → backend). Scenarios **skip** (never fail)
when the stack is unreachable, and are **RED** (fail) when the stack is up and the
feature is unbuilt — the intended DISTILL posture. This suite is **not** run by the
refinery `--auto` gate (per CLAUDE.md, acceptance suites run separately, locally).

Driving port for every scenario: the auth-proxy HTTP surface (the discrete scenarios
target the auth-proxy directly at its honest seam; the walking skeleton drives the
full user-facing ingress at `reverse-proxy` to prove `Set-Cookie` survives nginx and
the cookie round-trips). This is an HTTP entry point, so per the DISTILL
"Driving Adapter Verification" mandate at least one scenario exercises it via its
real protocol (httpx) and asserts status + response shape + cookie headers.

## DWD-3 — Mandate 7 (RED-ready scaffolding): **N/A for this suite**

The acceptance suite imports only `httpx` and the local `driver` module — it imports
**no production module**, because it drives the auth-proxy (TypeScript) and `ui/`
(TypeScript) over HTTP against a running stack, exactly like `org-onboarding`. There
are therefore no Python production modules to scaffold; RED comes from the running
stack returning the pre-migration response, not from an `AssertionError` stub. No
`__SCAFFOLD__` files are created, and **no auth-proxy/ui/ source is touched** — which
also keeps the gated backend `pytest` path and the refinery `--auto` gate green so the
DISTILL MR lands fast.

## DWD-4 — `ui/` slices (C3/C4) are validated by vitest in DELIVER, not by this suite

The API-level acceptance suite exercises the auth-proxy contract (C1/C2) directly and
end-to-end via the ingress, but it **cannot** exercise `ui/`'s React code (it uses its
own httpx client). The `ui/` transport (C3) and gate (C4) slices are therefore driven
by `ui/` vitest specs **authored in DELIVER** (file paths + assertions are specified in
`roadmap.json`), plus a manual/Playwright pass. We deliberately do **not** commit
failing vitest files into `ui/` in this DISTILL MR: that would touch `ui/` source
(breaking the "docs + non-gated acceptance venv only" gate-safety of this MR) and land
a red `ui/` suite on a shared branch. The roadmap's C3/C4 `failing_test` fields name the
exact specs to write first in DELIVER.

## DWD-5 — Test seam honesty (why each scenario is genuinely RED or a guard)

Verified against `auth-proxy/app.ts` so RED-by-design is real, not theatre:

- The catch-all `/api/*` branch (app.ts:692–732) requires `Authorization: Bearer`
  **unconditionally** (no dev bypass — unlike `/ui-state/*` and `/worker/*`). So a
  **cookie-only** `/api/*` request is **401 today** and becomes 200 only when C1
  cookie-read lands → genuinely RED.
- The callback (app.ts:126–151) sets **no `Set-Cookie`** today → the cookie-attribute
  assertions are genuinely RED until C1.
- `GET /api/auth/me` does not exist → today it falls to the catch-all and 401s on a
  cookie-only request → the identity-read scenario is genuinely RED until C2; the
  "neither credential → 401" half is a guard (passes now and after).
- Logout (app.ts:196–209) sets **no `Set-Cookie`** today → the cookie-teardown
  assertion is genuinely RED until C2.
- Header-wins (valid Bearer + invalid cookie → 200) and "Bearer still authorizes"
  are **guards** (green now and after): they lock that adding cookie-read must not
  break or override a present header (D3, D9). Marked `regression`, not `pending`.
