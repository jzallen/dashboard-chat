# NFR-U3: Multi-Sheet Confirmation

## Tag

U3 — Upload: Usability

## Ambition

Prevent accidental processing of unintended sheets by requiring explicit user selection when an Excel file contains multiple sheets.

## Quality Attribute Scenario

| Element | Value |
|---------|-------|
| **Source** | End user |
| **Stimulus** | Uploads a multi-sheet Excel file |
| **Environment** | Normal operation |
| **Artifact** | Upload state machine |
| **Response** | System pauses, presents sheet options, waits for user selection |
| **Response Measure** | No data processed without explicit user confirmation |

## Status

**Implemented** — `awaiting_input` state with choices list

## Verification Method

Upload a multi-sheet Excel file and verify that the system enters `awaiting_input` state, presents sheet choices, and does not process any data until the user selects a sheet.

## Related

- Upload entity
