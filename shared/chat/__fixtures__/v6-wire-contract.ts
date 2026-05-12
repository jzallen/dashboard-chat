/**
 * Single source of truth (TS half) for the v6 SSE wire-format contract test.
 *
 * Loads `v6-wire-contract.json` and reconstructs the canonical v6 SSE byte
 * stream by joining the JSON `frames` with the v6 separator `\n\n`. The
 * Python loader (`v6_wire_contract.py`) reads the same JSON and applies the
 * same join, so both languages exercise byte-identical input.
 *
 * Consumers:
 *   - `agent/test/chat/acceptance/wire-contract.test.ts`
 *   - `reverse-proxy/src/core/chat/__tests__/wire-contract.test.ts`
 *
 * Editing rule: only modify `v6-wire-contract.json`. Both loaders are pure
 * derivations; never hand-edit the bytes here.
 */

import type { ChatEvent } from "../events";
import contract from "./v6-wire-contract.json" with { type: "json" };

const FRAME_SEPARATOR = "\n\n";

/**
 * Canonical UTF-8 byte stream reconstructed from `frames`. Frames are joined
 * with `\n\n` and a trailing `\n\n` is appended so the last frame is a
 * well-formed v6 chunk (terminated by a blank line) rather than dangling.
 */
export const V6_CONTRACT_BYTES: Uint8Array = new TextEncoder().encode(
  contract.frames.join(FRAME_SEPARATOR) + FRAME_SEPARATOR,
);

/**
 * Expected ChatEvent[] surfaced by every parser, in stream order. Cast is
 * safe because the JSON file is hand-curated to match the discriminated-union
 * shape exported by `shared/chat/events.ts`.
 */
export const V6_CONTRACT_EXPECTED_EVENTS: ChatEvent[] = contract.expected_events as ChatEvent[];
