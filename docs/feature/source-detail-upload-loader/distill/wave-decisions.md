# DISTILL wave decisions — source-detail-upload-loader (DC-184)

Reconciliation: **passed — 0 contradictions.** DC-184 is a read-path slice under
the Release 6 "Retire backendClient / single boundary" milestone; it reuses the
`project-layout` server-loader pattern and the seams DC-155 intentionally kept
(`SourceUpload` type, the `sourceUploads` payload field, `seedProjectScoped`).

## DWD-01 — Delivery mechanism: source/:sourceId route loader (not catalog-seed)

**Confirmed by product (Zach Allen).** Uploads are fetched by a new
`project/:projectId/source/:sourceId` **server route loader**, not seeded into the
catalog snapshot.

**Why:** uploads are per-source (keyed by source id, not project). The
`project-layout` loader and `useCatalog.seedProjectScoped` both deliberately keep
`sourceUploads` OFF the project snapshot (they carry the field for shape parity
but never commit it) to avoid fanning the project loader out across every source.
A route loader keyed on the source id is the pattern those comments were written
for. The catalog-seed alternative would require reworking one of those seams.

**Consequence:** the `sourceUploads` field on `ProjectScopedData` /
`seedProjectScoped` stays inert (carried for parity) — out of scope to remove here.

## DWD-02 — Fresh-upload ordering: persisted-first, fresh appended after

**Confirmed by product.** The Files list renders backend history first (oldest
-first, as the endpoint returns it), and a fresh in-session optimistic upload
appends AFTER it. Matches the modal's current `[...prev, freshRow]` append
direction — no reversal.

## DWD-03 — Modal open stays imperative; loader invoked via useFetcher

The upload modal is an imperative overlay (`upload.modal.open`, opened from the
Topbar and from a source-node click via `useOpenNode`), not a route element.
Rather than refactor the modal into a navigation-driven modal route, the
recommended wiring keeps the overlay and calls `useFetcher().load()` against the
new `source/:sourceId` loader when the modal opens for an existing source. The
loader still runs server-side (the browser only hits the same-origin `.data`
endpoint), so the "no browser-direct /api" guarantee holds. **Revisitable in
DELIVER** if a modal route proves cleaner, but the fetcher keeps the blast radius
small.

## DWD-04 — Graceful degradation differs from the project loader

The project loader THROWS a non-401 read failure to its `ErrorBoundary` (no silent
empty catalog). The source-detail loader does the OPPOSITE: a non-401 failure is
caught and degrades to an empty Files list so the modal still opens and the user
can still upload (per DC-184 acceptance: "load failure degrades gracefully"). A
401 still redirects to `/login`. This divergence is intentional and asymmetric —
recorded here so a reviewer does not "fix" it into a throw.

## DWD-05 — Walking-skeleton / acceptance strategy (UI)

Router-level (Strategy A-equivalent for a UI feature). The acceptance test drives
the REAL route loader through `createMemoryRouter` navigation (route hooks proven
through the router, never called directly), the REAL `toSourceUploads` mapper, and
a REAL `UploadModal` render. The only faked seam is the network boundary — the
loader's `apiFetch`/`fetch` is stubbed to return a JSON:API `uploads` envelope.

**What the fake cannot model:** the real cookie->Bearer auth-proxy hop and any
drift in the live JSON:API envelope shape. Those are covered by the existing
end-to-end/broker tests and the backend's own `list_source_uploads` tests, not
re-proven here.

## Out of scope (explicit)

- **Files-above-Schema reorder** shown in the design mockup: the current modal
  intentionally places Schema above Files (so adding a file doesn't push the
  schema down) — confirmed intentional by product. DC-184 is the read path only;
  any reorder is a separate ticket.
- No backend change: `GET /api/sources/{source_id}/uploads` already exists.
- The write saga (create/request/put/process) is untouched.
