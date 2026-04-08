# NFR-U4: Format Extensibility

## Tag

U4 — Upload: Extensibility

## Invariant

> Adding a new file format (e.g., Avro, Synthea FHIR bundles) SHALL require only a new plugin module — no changes to core upload logic.

## Status

**Implemented** — plugin registry pattern

## Verification Method

Confirm that the upload system uses a plugin registry. Adding a new format plugin should not require modifications to core upload router or processing logic.

## Related

- Upload entity
