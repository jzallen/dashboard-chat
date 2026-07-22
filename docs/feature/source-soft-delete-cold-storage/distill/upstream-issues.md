# Upstream Issues — source-soft-delete-cold-storage (DISTILL → prior waves)

DISTILL back-propagation status. One prior-wave item; already resolved in DESIGN.

## 1. AC1.2 cross-org status code: 404 → 403 (RESOLVED, carried forward)

`discuss/user-stories.md` AC1.2 (and `discuss/wave-decisions.md` D4, and the DC-199 Linear
description D4) state cross-org access returns **404** "never leaking existence."

DESIGN reconciled this to **403** for cross-org (unknown id stays **404**) — the established
platform posture (`_authorize_source` → `authorize_project_access`, `backend/app/routers/deps.py:88`),
ratified in ADR-055 §amendment and documented in `design/upstream-changes.md`.

DISTILL authors the acceptance test against **403** for cross-org and **404** for unknown id
(scenarios "I cannot touch a source that belongs to another organization" and "Moving a
source that isn't there tells me it isn't there").

**Residual doc drift (non-blocking):** `discuss/user-stories.md` AC1.2, `discuss/wave-decisions.md`
D4, and the Linear DC-199 description D4 still read "404 (never 403)". The binding truth is
ADR-055 §amendment (403). Recommend the product owner update AC1.2 text on the next
`/nw-discuss` touch; not blocking DISTILL or DELIVER since the acceptance test encodes the
corrected behaviour and the ADR is the SSOT.

## 2. No other contradictions

All other DISCUSS AC (idempotency clock-preservation, default-exclude listing, read-contract
exposure, symmetric restore) are consistent across DISCUSS → DESIGN → ADR-055 and testable
as written. 0 untestable criteria.
