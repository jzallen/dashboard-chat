// SCAFFOLD: true — DISTILL RED scaffold for fixture-replay harness (TWD-2 / UI-2).
// PR 0 polecat builds the real harness: a recorder that captures live Groq
// responses during walking-skeleton runs, plus a replayer that intercepts
// fetch() to @ai-sdk/groq during tests and serves the recorded bytes.

export const __SCAFFOLD__ = true;

const NOT_IMPLEMENTED = "Not yet implemented — RED scaffold (DISTILL output for worker-tool-dispatch-refactor)";

export type GroqFixture = {
  family: "cleaning" | "mutations" | "ui";
  scenario: string;
  recordedBytes: Uint8Array;
};

export function recordGroqFixture(_family: GroqFixture["family"], _scenario: string): never {
  throw new Error(NOT_IMPLEMENTED);
}

export function replayGroqFixture(_family: GroqFixture["family"], _scenario: string): never {
  throw new Error(NOT_IMPLEMENTED);
}
