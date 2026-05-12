"""Cross-stack v6 SSE wire-format contract — backend half.

Loads the same canonical v6 SSE byte stream from the SSOT fixture
(``shared/chat/__fixtures__/v6-wire-contract.json``) that the agent and
frontend contract tests consume, and asserts that the harness's
``parse_chat_event_frames`` surfaces the same ``expected_events``.

See also:
  - ``agent/test/chat/acceptance/wire-contract.test.ts`` (agent parser)
  - ``frontend/src/core/chat/__tests__/wire-contract.test.ts`` (frontend
    parser)

If any one of these three tests fails while the others pass, the parsers
have drifted apart on the v6 envelope shape — fix the offending parser to
match the SSOT.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from backend.tests.integration.dataset_layer.harness import parse_chat_event_frames

# The shared/ tree is not on sys.path by default (backend's conftest only adds
# the backend dir). Load the SSOT loader by file path so this test stays
# self-contained without modifying broader test infrastructure.
_REPO_ROOT = Path(__file__).resolve().parents[4]
_SSOT_PATH = _REPO_ROOT / "shared" / "chat" / "__fixtures__" / "v6_wire_contract.py"


def _load_ssot():
    spec = importlib.util.spec_from_file_location("_v6_wire_contract_ssot", _SSOT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load SSOT fixture at {_SSOT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_ssot = _load_ssot()
V6_CONTRACT_BYTES: bytes = _ssot.V6_CONTRACT_BYTES
V6_CONTRACT_EXPECTED_EVENTS: list = _ssot.V6_CONTRACT_EXPECTED_EVENTS


def test_v6_wire_contract_harness_parser_matches_ssot_expected_events() -> None:
    events, raw_tool_call_seen = parse_chat_event_frames(V6_CONTRACT_BYTES)

    assert raw_tool_call_seen is False
    assert events == V6_CONTRACT_EXPECTED_EVENTS, (
        "harness parser drifted from the SSOT v6 wire contract: "
        f"expected {V6_CONTRACT_EXPECTED_EVENTS!r}, got {events!r}"
    )
