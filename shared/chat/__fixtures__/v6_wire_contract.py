"""Single source of truth (Python half) for the v6 SSE wire-format contract test.

Loads ``v6-wire-contract.json`` and reconstructs the canonical v6 SSE byte
stream by joining the JSON ``frames`` with the v6 separator ``\\n\\n``. The
TypeScript loader (``v6-wire-contract.ts``) reads the same JSON and applies the
same join, so both languages exercise byte-identical input.

Consumer:
  - ``backend/tests/integration/dataset_layer/test_wire_contract.py``

Editing rule: only modify ``v6-wire-contract.json``. This module is a pure
derivation; never hand-edit the bytes here.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_FRAME_SEPARATOR = "\n\n"
_CONTRACT_JSON_PATH = Path(__file__).parent / "v6-wire-contract.json"


def _load_contract() -> dict[str, Any]:
    with _CONTRACT_JSON_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


_contract = _load_contract()

# Canonical UTF-8 byte stream reconstructed from ``frames``. Frames are joined
# with ``\n\n`` and a trailing ``\n\n`` is appended so the last frame is a
# well-formed v6 chunk (terminated by a blank line) rather than dangling.
V6_CONTRACT_BYTES: bytes = (_FRAME_SEPARATOR.join(_contract["frames"]) + _FRAME_SEPARATOR).encode("utf-8")

# Expected ChatEvent dicts surfaced by the harness parser, in stream order.
# Matches the TS-side ``V6_CONTRACT_EXPECTED_EVENTS`` after Zod parsing.
V6_CONTRACT_EXPECTED_EVENTS: list[dict[str, Any]] = list(_contract["expected_events"])
