# WorkOS Auth Hardening — Implementation Prompt

> **System prompt**: `.claude/system_prompts/SOFTWARE_ENGINEER.md`
> **OpenSpec change**: `openspec/changes/workos-auth-hardening/`

## Context

The Solutions Architect has completed the full OpenSpec spec-driven workflow for `workos-auth-hardening`. All 4 artifacts are ready:

| Artifact | Path |
|----------|------|
| Proposal | `openspec/changes/workos-auth-hardening/proposal.md` |
| Design | `openspec/changes/workos-auth-hardening/design.md` |
| Specs (8 capabilities) | `openspec/changes/workos-auth-hardening/specs/*/spec.md` |
| Tasks | `openspec/changes/workos-auth-hardening/tasks.md` |

## Existing Work

An initial implementation pass was made by agent teammates. Their changes are **uncommitted in the working tree** (18 files, +232/-62 lines). These changes cover most but not all of the spec — and were written before the spec existed.

**Your job is to reconcile the existing changes with the spec, not blindly accept them.**

## Instructions

### Phase 1: Read the spec artifacts

Read these files in order:
1. `openspec/changes/workos-auth-hardening/proposal.md` — why and what
2. `openspec/changes/workos-auth-hardening/design.md` — how and why-not (decisions D10–D20)
3. All 8 spec files in `openspec/changes/workos-auth-hardening/specs/*/spec.md` — requirements and scenarios
4. `openspec/changes/workos-auth-hardening/tasks.md` — implementation checklist

### Phase 2: Audit existing changes against the spec

Review every uncommitted change (`git diff HEAD`) and compare it to the spec:

```bash
git diff HEAD -- backend/app/auth/
git diff HEAD -- backend/app/routers/auth.py
git diff HEAD -- frontend/src/lib/api/
git diff HEAD -- frontend/src/lib/auth/
git diff HEAD -- frontend/src/lib/ui/context/ChatContext.tsx
git diff HEAD -- worker/lib/auth.ts
```

For each changed file, answer:
- Does the change match the spec requirement? Keep it.
- Does the change go beyond the spec? Evaluate — keep if it's a strict improvement, revert if speculative.
- Does the change contradict the spec? Fix it.
- Is the change missing something the spec requires? Add it.

### Phase 3: Implement missing work

The one significant gap between existing changes and the spec is **OAuth state verification** (spec: `oauth-authorize-flow`):

1. **`frontend/src/lib/auth/AuthContext.tsx`** — the `login()` function must store the `state` returned from `/api/auth/login` into `sessionStorage` under key `oauth_state`
2. **`frontend/src/lib/ui/components/AuthCallback/index.tsx`** — must read `state` from URL query params, compare to `sessionStorage.getItem("oauth_state")`, reject on mismatch by redirecting to `/login`, and remove `oauth_state` from sessionStorage after comparison
3. **Tests** — add test cases for: state match (proceeds), state mismatch (redirects to /login), missing state param (redirects), missing sessionStorage (redirects)

### Phase 4: Run all tests

```bash
cd backend && uv run pytest tests/ -k auth -x
cd frontend && npx vitest run
npm run test:worker
```

All must pass. Fix any failures.

### Phase 5: Walk the task checklist

Open `openspec/changes/workos-auth-hardening/tasks.md` and mark each checkbox as you verify it. The "verify existing" groups (1, 3, 4, 5, 6) should mostly pass against the uncommitted changes. Group 2 (state verification) is the new implementation work.

## Key Design Decisions to Enforce

These are from `design.md` and must be reflected in the code:

- **D10/D11**: JWT verification uses `audience=client_id`, `issuer="https://api.workos.com"`, `algorithms=["RS256"]` — same params in backend AND worker
- **D12**: State stored in `sessionStorage` (not localStorage) — tab-scoped, ephemeral
- **D14**: Worker uses `jose.jwtVerify()` with `createRemoteJWKSet()` — no `/api/auth/me` calls
- **D15**: Session revocation is best-effort, 5s timeout, fire-and-forget from frontend
- **D16**: 12s retry delay for all refresh failures (not 5s for non-429)
- **D17**: Proactive refresh timer skipped in dev mode
- **D18**: Proactive refresh retries 3x (30s, 60s escalation), does NOT force logout
- **D19**: Chat SSE 401 retry failure calls `hardLogout()`

## Spec Divergences to Watch For

The design doc flags these drift items between the prior `token-refresh-flow` spec and current implementation. The new specs ratify the implementation. Make sure the code matches:

| Item | Old Spec | New Spec (matches implementation) |
|------|----------|-----------------------------------|
| Inactivity threshold | 60 minutes | 20 minutes |
| Modal timeout | 5 minutes | 10 minutes |
| Proactive refresh failure | 1 retry then logout | 3 retries, no logout |
| SSE 401 final failure | No redirect | `hardLogout()` (redirect to /login) |
| Refresh retry delay | 5 seconds | 12 seconds |

## Out of Scope

Do NOT implement:
- `secure-token-storage` capability (P3 — httpOnly cookies, design only)
- Connect/OAuth2 migration (P2 — separate change)
- PKCE support (follow-up)
- Mid-stream 401 recovery (known v1 limitation)

## Deliverable

A clean set of commits on `v2-dev` covering:
1. All P0-P2 auth hardening changes (verified against spec)
2. OAuth state verification (new implementation)
3. All tests passing
4. Task checklist fully marked

Use `opsx:apply` if available, or implement manually following the tasks.
