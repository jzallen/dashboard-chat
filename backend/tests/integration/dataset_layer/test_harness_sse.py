"""Unit-of-work test for the harness SSE parser.

The dataset_layer harness consumes the agent's chat SSE stream. Step 01-02
migrated the agent to emit AI SDK v6 ``data: {...}\\n\\n`` SSE frames whose
payloads carry typed parts (e.g. ``data-chat-event``). This test pins the
harness's parser to that v6 wire format using a synthetic byte stream — it
runs without the live compose stack so the parser contract is guarded
independently of step 03-01's live verification.

Reference v6 frame shapes (from reverse-proxy/src/core/chat/services/chatStream.ts
and agent/test/chat/_v6Mocks.ts):

    data: {"type":"text-delta","id":"...","delta":"..."}\\n\\n
    data: {"type":"data-chat-event","id":"...","data":{<ChatEvent>}}\\n\\n
    data: {"type":"data-agent-request","id":"...","data":{<AgentRequest>}}\\n\\n
    data: {"type":"finish","finishReason":"stop",...}\\n\\n
    data: [DONE]\\n\\n
"""

from __future__ import annotations

import json

from backend.tests.integration.dataset_layer.harness import parse_chat_event_frames


def _v6_frame(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def test_parses_v6_data_chat_event_part_into_chat_event() -> None:
    """A ``data-chat-event`` v6 part surfaces ``payload['data']`` as a ChatEvent."""
    transform_applied = {
        "type": "transform_applied",
        "dataset_id": "ds-1",
        "transform_id": "t-1",
        "operation": "trim",
        "column": "region",
    }
    stream = (
        _v6_frame({"type": "start"})
        + _v6_frame({"type": "text-delta", "id": "msg-1", "delta": "ok"})
        + _v6_frame({"type": "data-chat-event", "id": "e-1", "data": transform_applied})
        + _v6_frame({"type": "finish", "finishReason": "stop"})
        + "data: [DONE]\n\n"
    ).encode("utf-8")

    events, raw_tool_call_seen = parse_chat_event_frames(stream)

    assert raw_tool_call_seen is False
    assert events == [transform_applied], (
        f"expected exactly one ChatEvent surfaced from data-chat-event; got {events!r}"
    )


def test_ignores_non_chat_event_v6_parts() -> None:
    """``text-delta``, ``finish``, and ``data-agent-request`` are not ChatEvents."""
    stream = (
        _v6_frame({"type": "text-delta", "id": "msg-1", "delta": "hello"})
        + _v6_frame({"type": "data-agent-request", "id": "r-1", "data": {"type": "resolve_dataset", "params": {}}})
        + _v6_frame({"type": "finish", "finishReason": "stop"})
        + "data: [DONE]\n\n"
    ).encode("utf-8")

    events, raw_tool_call_seen = parse_chat_event_frames(stream)

    assert raw_tool_call_seen is False
    assert events == [], f"non-chat-event parts must not surface as ChatEvents; got {events!r}"


def test_collects_multiple_chat_events_in_order() -> None:
    """Multiple ``data-chat-event`` frames surface in stream order."""
    e1 = {"type": "transform_applied", "transform_id": "t-1", "operation": "trim", "column": "a"}
    e2 = {"type": "transform_applied", "transform_id": "t-2", "operation": "trim", "column": "b"}
    stream = (
        _v6_frame({"type": "data-chat-event", "id": "e-1", "data": e1})
        + _v6_frame({"type": "data-chat-event", "id": "e-2", "data": e2})
        + _v6_frame({"type": "finish", "finishReason": "stop"})
    ).encode("utf-8")

    events, _ = parse_chat_event_frames(stream)

    assert events == [e1, e2]


def test_tolerates_malformed_frames() -> None:
    """A malformed JSON frame is skipped; valid frames around it still parse."""
    good = {"type": "transform_applied", "transform_id": "t-1", "operation": "trim", "column": "x"}
    stream = (
        b"data: {not valid json\n\n"
        + _v6_frame({"type": "data-chat-event", "id": "e-1", "data": good}).encode("utf-8")
        + b"\n\n"  # blank
    )

    events, raw_tool_call_seen = parse_chat_event_frames(stream)

    assert raw_tool_call_seen is False
    assert events == [good]


def test_empty_stream_yields_no_events() -> None:
    events, raw_tool_call_seen = parse_chat_event_frames(b"")
    assert events == []
    assert raw_tool_call_seen is False
