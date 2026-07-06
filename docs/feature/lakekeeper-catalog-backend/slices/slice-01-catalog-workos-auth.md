# Slice 01 — Catalog authenticates to WorkOS + user auto-provisions

**Story:** US-1 · **Sub-job:** SJ-1 · **Plane:** Auth · **Effort:** ~1 day (incl. `@infrastructure`: stand up the org's LakeKeeper Server)

## Goal (one sentence)
Point one org's LakeKeeper Server at the same WorkOS AuthKit issuer the app already uses and confirm a real WorkOS token authenticates the catalog and auto-provisions a user — so there is one identity source and no user-sync job.

## IN scope
- Stand up one org's LakeKeeper Server (`@infrastructure`, non-prod) with `LAKEKEEPER__OPENID_PROVIDER_URI` = the WorkOS AuthKit issuer and `OPENID_AUDIENCE` = our client id.
- Present a valid WorkOS **user** token (and/or an auth-proxy-minted **M2M** token) to the catalog; confirm authN succeeds and a user auto-provisions (keyed `oidc~<sub|oid>`).
- Confirm a wrong-issuer / wrong-audience token is **rejected** with no user provisioned.

## OUT scope
- The **authZ boundary** (LakeKeeper OpenFGA-authoritative vs trust-the-proxy) — **surfaced as a DESIGN open fork**, not decided here. The slice only proves authN.
- Project/Warehouse creation (Slice 02).
- Any production hardening or multi-tenant control-plane provisioning.

## Learning hypothesis
**Disproves** that one org's LakeKeeper Server can trust the **same** WorkOS AuthKit issuer and **auto-provision** a user from a real WorkOS token **without** a second identity store or a user-sync job. If a token that works for the app cannot authenticate the catalog, the "one identity source" premise (and the proven-OIDC-path claim, `../discover/buy-vs-build.md` Q3) fails.
**Confirms** (if it succeeds) that identity is a single source across app and catalog, and the credential handshake's first hop is sound.

## Acceptance criteria
- AC1: A valid WorkOS token presented to the catalog authenticates successfully and auto-provisions a catalog user — **no user-sync job runs** (production data, a real WorkOS token, not a synthetic JWT).
- AC2: A token whose issuer or audience does not match the configured values is rejected with an authentication error and **no user is provisioned**.
- AC3: The catalog's IdP config references the WorkOS AuthKit issuer + our audience (not a hand-rolled user list).

## Dependencies
None (foundation). Establishes the authenticated catalog every later slice needs; identifies which token flow (forwarded user token vs minted M2M) the later write path uses.

## Dogfood moment
Present your own real WorkOS token to the running catalog and watch the user auto-provision; present a deliberately wrong-audience token and watch it get rejected.

## Reference class
Standard OIDC integration against a provider that exposes `/.well-known/openid-configuration` with `issuer` + `jwks_uri`; WorkOS AuthKit exposes exactly that, and we already consume WorkOS JWKS (`auth-proxy/lib/auth.ts:94-96`). Low research risk (`../discover/buy-vs-build.md` Q3); the real unknown (authZ) is deliberately deferred.
