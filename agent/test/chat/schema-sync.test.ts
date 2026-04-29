/**
 * Schema sync — agent ↔ frontend ChatEventSchema verbatim duplicate check.
 *
 * Per TWD-8 option 1, agent/lib/chat/events.ts and frontend/src/core/chat/
 * events.ts are intentionally identical (the frontend file carries a leading
 * comment block, then matches the agent file byte-for-byte). This test catches
 * drift before it ships. F2 (dc-bj2.2) replaces the duplication with a
 * shared/chat SSOT and removes the need for this test.
 *
 * Bazel data dep: //frontend:src/core/chat/events.ts (declared in agent/
 * BUILD.bazel test rule). If the file is absent from the runfiles tree (e.g.
 * a sandboxed run that did not include the data dep), we skip with a warning
 * rather than fail — the structural intent is still preserved when the test
 * runs from the worktree.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("schema sync — agent ↔ frontend ChatEventSchema", () => {
  it("frontend events.ts is a verbatim duplicate of agent events.ts (modulo leading comment)", () => {
    const agentPath = resolve(__dirname, "../../lib/chat/events.ts");
    const frontendPath = resolve(
      __dirname,
      "../../../frontend/src/core/chat/events.ts",
    );

    if (!existsSync(frontendPath)) {
       
      console.warn(
        `schema-sync skipped — frontend events.ts not in sandbox runfiles (${frontendPath})`,
      );
      return;
    }

    const agentSrc = readFileSync(agentPath, "utf8");
    const frontendSrc = readFileSync(frontendPath, "utf8");

    // Strip the leading // comment block + the blank line that follows.
    const stripped = frontendSrc.replace(/^(\/\/.*\n)+\n?/, "");

    expect(stripped).toBe(agentSrc);
  });
});
