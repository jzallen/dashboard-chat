# Upstream Changes — source-soft-delete-cold-storage (DESIGN → DISCUSS)

DESIGN found one contradiction between a DISCUSS acceptance criterion and the established
platform authorization posture. Resolved in favor of the platform convention.

## Changed Assumption: cross-org archival returns 403, not 404

**Original (DISCUSS, `discuss/user-stories.md` AC1.2):**
> "The operation is **`org_id`-scoped**: a source belonging to another org returns `404`
> (not `403`), never leaking existence."

**New (DESIGN, ratified in ADR-055 §amendment):**
Cross-org archival returns **403** (`AuthorizationError`); only a genuinely unknown source
id returns **404** (`SourceNotFound`).

**Rationale:**
- `authorize_project_access` **deliberately** raises `AuthorizationError` (403) for
  cross-tenant access "rather than collapsing to not-found" (`backend/app/routers/deps.py:88`).
- Every existing source endpoint already routes through `_authorize_source` →
  `authorize_project_access` (`backend/app/routers/sources.py:22`), and every dataset endpoint
  through `authorize_dataset_access`, so 403-for-cross-org is the uniform, load-bearing posture.
- Honoring the AC's 404 would make the PATCH route the **only** source endpoint that hides
  cross-org existence — an inconsistency, and a change to a security-relevant convention that
  is out of scope for this feature.

**Action for the product owner:** update AC1.2 in `discuss/user-stories.md` to read "cross-org
→ 403; unknown id → 404." No other AC changes. The Gherkin `Cross-org isolation` scenario in
`discuss/journey-source-cold-storage.feature` should assert `403` (currently `404`); DISTILL
will author the acceptance test against 403.

No requirements were weakened — org isolation is still enforced; only the status code the wave
assumed is corrected to the platform standard.
