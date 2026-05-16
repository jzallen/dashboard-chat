// LEAF-6 — Remove the alias map once the FE consumes canonical
// machine-name paths.
//
// DISTILL-authored binding contract (ADR-040 §D5, LEAF-6).
// DELIVER-deferred: `describe.skip` until LEAF-6.
//
// Behavior-neutrality: BEHAVIOR-NEUTRAL **once the FE is migrated** — the
// precondition test is the gate that makes it neutral. Deleting the alias
// before the FE migrates would break ADR-027 §1; the precondition assertion
// makes that impossible.
//
// Binding source:
//   ADR-040 §D5 + LEAF-6 ("once the FE consumes canonical machine-name
//     paths, remove the alias map"; aliases removed in a terminal cleanup
//     LEAF once the FE has migrated to canonical paths),
//   ADR-027 §1 (FE projection read contract — only safe to 404 the legacy
//     segment after the FE no longer requests it).

import { describe, it } from "vitest";

const LEGACY_SEGMENT = "/flow/project-and-chat-session-management";
const CANONICAL_SEGMENT = "/flow/project-context";

describe.skip("LEAF-6 alias removal — DELIVER-deferred to LEAF-6", () => {
  it("PRECONDITION (gates deletion): no non-test consumer requests the legacy feature-slug path", () => {
    // DELIVER LEAF-6 — this test MUST be green BEFORE the alias mount is
    // deleted (it is the safety interlock):
    //   - zero non-test references to LEGACY_SEGMENT remain under frontend/
    //     (frontend/app/lib/ui-state-client.ts + routes migrated to
    //     CANONICAL_SEGMENT),
    //   - the J-002 acceptance suite driver has migrated to CANONICAL_SEGMENT
    //     (tests/acceptance/project-and-chat-session-management/driver.py).
    // If this assertion is not green, LEAF-6 does NOT proceed (Iron Rule:
    // the precondition is never weakened to unblock the deletion).
    void LEGACY_SEGMENT;
    void CANONICAL_SEGMENT;
  });

  it("POST-removal: legacy feature-slug path returns 404; canonical path returns 200", () => {
    // DELIVER LEAF-6: after deleting the legacy alias app.route mount
    // (in-process wireRoutes + app.fetch):
    //   - GET/POST /flow/project-and-chat-session-management/* -> 404,
    //   - GET/POST /flow/project-context/* -> 200, byte-identical to the
    //     pre-removal canonical behavior for the same flow_id,
    //   - /flow/session-chat/* and /flow/login-and-org-setup/* unaffected
    //     (they were never aliases — canonical == legacy segment).
  });

  it("characterization: full mr_1..mr_6 per-marker green on canonical paths", () => {
    // DELIVER LEAF-6 = RG-LEAF. The acceptance suite — migrated to
    // canonical paths as part of satisfying the precondition — stays green
    // PER-MARKER (D-MR5-02 ordering hazard; baseline mr_4 14/0/0 · mr_5 7/0
    // · mr_6 8/0). ui-state vitest green; eslint 0 errors.
  });
});
