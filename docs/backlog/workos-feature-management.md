# WorkOS Feature Management

## Summary

Explore using WorkOS feature flags to control debug features and other feature toggles instead of Vite environment variables.

## Motivation

We currently gate debug features (e.g., `VITE_DEBUG_ACTIVITY`) with build-time environment variables. This has limitations:

- **Requires a rebuild** to change flag values in deployed environments
- **No per-user or per-org targeting** — the flag is global to the build
- **No audit trail** of when flags were toggled

WorkOS offers feature management that integrates with our existing WorkOS auth. This would let us:

- Toggle debug features at runtime without redeploying
- Target flags by organization or user (e.g., enable debug badges for QA org only)
- Use the same WorkOS dashboard we already use for auth management

## Scope

- Evaluate WorkOS feature flag API and SDK support
- Identify candidate flags beyond debug activity (e.g., experimental UI features, beta access)
- Prototype a `useFeatureFlag(name)` hook that checks WorkOS at login and caches results
- Consider fallback behavior when WorkOS is unavailable (default to env vars)

## Status

Backlog — not yet prioritized.
