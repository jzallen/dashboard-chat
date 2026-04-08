# NFR-U1: Upload Size Limit

## Tag

U1 — Upload: Performance

## Ambition

Enforce a maximum file size on uploads to protect backend resources and encourage efficient file formats for large datasets.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Maximum file size accepted by POST /api/uploads |
| **Meter** | Reject with HTTP 413 when file exceeds threshold |
| **Must** | 200 MB |
| **Plan** | 100 MB (tighter limit encourages Parquet pre-conversion for large files) |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Uploads a file via POST /api/uploads |
| **Environment** | Normal operation |
| **Artifact** | Upload router |
| **Response** | System accepts files under the threshold; rejects with HTTP 413 when file exceeds it |
| **Response Measure** | Files up to 200 MB (Must) / 100 MB (Plan) accepted; larger files rejected immediately |

## Status

**Not implemented** — no size check in upload router. FHIR plugin enforces 100MB independently.

## Verification Method

Upload files of varying sizes (e.g., 99 MB, 101 MB, 199 MB, 201 MB) and verify the correct HTTP status code is returned for each.

## Related

- Upload entity
