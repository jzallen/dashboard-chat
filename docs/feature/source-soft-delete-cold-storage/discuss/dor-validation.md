# Definition of Ready — source-soft-delete-cold-storage

| # | DoR item | Status | Evidence |
|---|----------|--------|----------|
| 1 | User story in role-goal-benefit form | ✅ | 3 stories, `user-stories.md` |
| 2 | Acceptance criteria testable & unambiguous | ✅ | AC1.1–AC3.3 tied to observable HTTP output |
| 3 | Dependencies identified | ✅ | Reuses `sources` router, use-case decorator stack, metadata repo; dataset cold-storage as reference; DC-139 (hard delete) and UI wiring called out as downstream |
| 4 | Sized / sliced to ≤1 day | ✅ | 3 carpaccio slices, each ≤1 day, `story-map.md` |
| 5 | No blocking unknowns | ⚠️ | One open decision routed to DESIGN/ADR: PATCH body schema (`{archived:boolean}` vs `status` enum) and field-name convention (reuse `archived_at` vs new `deleted_at`). Recommended defaults set; see `wave-decisions.md` D1/D2. Not blocking for slicing. |
| 6 | Measurable outcome defined | ✅ | `outcome-kpis.md` (5 KPIs with targets) |
| 7 | Aligned with architecture/SSOT | ✅ | Mirrors dataset cold-storage convention; no new SSOT journey required (extends catalogued J-003 neighborhood) |
| 8 | Testable at a port boundary | ✅ | HTTP route → use case → repository port; mocks only at repo port |
| 9 | Traceable to a job | ✅ | Light JTBD bridge; JOB-CANDIDATE documented (not yet ratified into `jobs.yaml`) |

**Verdict**: READY for DESIGN. Item 5 is an ADR-level decision, not a requirements gap —
DESIGN ratifies the PATCH body + field convention before DELIVER.
