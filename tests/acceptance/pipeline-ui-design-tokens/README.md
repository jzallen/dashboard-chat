# Acceptance — pipeline-ui-design-tokens (MR-1)

Driving-adapter acceptance for the design-token foundation + dark-mode plumbing:
the SSR ingress must serve HTML that already carries the theme class + an inline
pre-hydration init script, so first paint never flashes the wrong theme.

**Status: deferred / skipped.** Blocked by the SSR asset-hash 404 issue
(`../../docs/feature/pipeline-layers-ui-redesign/distill/upstream-issues.md`, UI-1).
The MR-1 walking skeleton is gated in vitest instead
(`frontend/app/theme/theme.test.tsx`, AC1), which proves the same init mechanism
under happy-dom without needing the container stack.

When SSR is unblocked, implement the two tests in `test_ssr_theme_init.py`
(httpx GET through the reverse-proxy, assert on served HTML) and remove the
module-level skip. Spec: `ssr-serves-default-theme-before-hydration.feature`.

```bash
# from inside this directory (per CLAUDE.md acceptance-suite convention)
cd tests/acceptance/pipeline-ui-design-tokens && uv run --no-project pytest
```
