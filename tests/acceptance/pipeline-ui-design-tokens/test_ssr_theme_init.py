"""SSR-ingress no-flash acceptance — the true driving-adapter check for MR-1.

DEFERRED. The walking skeleton for MR-1 is gated in vitest
(`frontend/app/theme/theme.test.tsx`, AC1), which proves the pre-hydration
theme-init mechanism under happy-dom without the container stack. These
HTTP-ingress scenarios are the eventual port-to-port verification (browser →
reverse-proxy → web-ssr → served HTML), but they cannot go green until the SSR
asset-hash 404 issue is resolved — see
`docs/feature/pipeline-layers-ui-redesign/distill/upstream-issues.md` (UI-1)
and `distill/wave-decisions.md` (DWD-2).

Un-skip and implement (httpx GET through the reverse-proxy, assert on the
served HTML) once SSR serves cleanly. Spec lives in
`ssr-serves-default-theme-before-hydration.feature`.
"""

import pytest

pytestmark = pytest.mark.skip(
    reason="Deferred: SSR asset-hash 404 blocker (upstream-issues UI-1). "
    "MR-1 walking skeleton is gated in vitest (theme.test.tsx AC1)."
)


@pytest.mark.real_io
@pytest.mark.adapter_integration
@pytest.mark.requires_external
def test_first_paint_html_carries_default_neobrutalist_light_theme() -> None:
    """Served HTML root carries the aesthetic class + no dark class, and the
    head contains the inline pre-hydration init script (no-flash default)."""
    raise AssertionError("Not yet implemented — deferred behind SSR blocker (UI-1)")


@pytest.mark.real_io
@pytest.mark.adapter_integration
@pytest.mark.requires_external
def test_inline_init_script_applies_persisted_dark_preference_before_paint() -> None:
    """The inline init script in the served HTML resolves a stored dark
    preference to the dark theme on first paint with no flash."""
    raise AssertionError("Not yet implemented — deferred behind SSR blocker (UI-1)")
