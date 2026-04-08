# NFR-U2: Time to Preview

## Tag

U2 — Upload: Performance

## Ambition

Ensure users see a rendered preview table quickly after uploading a file, maintaining a responsive upload experience.

## Planguage

| Field | Value |
|-------|-------|
| **Scale** | Wall-clock time from upload completion to rendered preview table |
| **Meter** | P95 measured on CSV files under 50MB |
| **Must** | < 5 seconds |
| **Plan** | < 3 seconds |

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Completes uploading a CSV file under 50 MB |
| **Environment** | Normal operation |
| **Artifact** | Upload pipeline (Parquet conversion + preview row generation) |
| **Response** | System converts file to Parquet and renders a preview table |
| **Response Measure** | P95 latency < 5 s (Must) / < 3 s (Plan) |

## Status

**Implemented** — Parquet conversion + preview row generation

## Verification Method

Measure P95 wall-clock time from upload completion to preview table render across a batch of CSV files under 50 MB.

## Related

- Upload entity
