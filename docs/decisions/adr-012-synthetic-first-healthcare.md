# ADR-012: Synthetic-First Healthcare Strategy via Synthea

## Status

Proposed

## Context and Problem Statement

The product targets healthcare as a vertical, but the initial design assumed ingesting real clinical data (HL7v2 via Mirth Connect, FHIR bundles). Real clinical data introduces HIPAA compliance, PHI handling, and complex authorization requirements -- all of which conflict with the product's core identity as a lightweight prototyping tool. The target user (healthcare POs and analysts) needs to prototype data models, not operate production clinical pipelines.

## Decision Drivers

- Avoid HIPAA compliance burden in the prototyping environment
- Realistic healthcare data for meaningful prototyping without PHI
- Clear separation of concerns between prototyping and production environments
- Alignment with the product thesis: prototype with synthetic data, hand off to engineering for production
- Accessible onboarding for healthcare POs and analysts

## Considered Options

1. **Synthetic data via Synthea as the primary healthcare workflow** (selected)
2. **Real clinical data ingestion via Mirth Connect as the primary workflow**

### Option 1: Synthea Synthetic Data

- Good, because Synthea generates realistic FHIR-format patient data (patients, encounters, observations, conditions, medications) without any PHI
- Good, because the prototyping environment never touches real patient data, completely sidestepping HIPAA
- Good, because the separation of concerns (prototype vs production) is the entire product thesis
- Bad, because Mirth Connect integration becomes a secondary feature rather than the primary healthcare story

### Option 2: Real Clinical Data via Mirth Connect

- Good, because it provides real-world data fidelity for prototyping
- Good, because Mirth Connect is an industry-standard integration engine
- Bad, because it introduces HIPAA compliance, PHI handling, and complex authorization requirements
- Bad, because it conflicts with the product's identity as a lightweight prototyping tool
- Bad, because it requires significant infrastructure and governance overhead

## Decision Outcome

Chosen option: **Synthea synthetic data**, because it provides realistic healthcare data for prototyping without PHI, aligning with the product thesis that prototyping and production are separate concerns.

### Consequences

- **Good:** The prototyping environment never touches real patient data. Users prototype against synthetic data, and the data engineering team takes the exported dbt project and connects it to real EHR data in a governed production environment. HIPAA compliance is the production team's responsibility, not the prototyping tool's
- **Bad:** The Mirth Connect integration (`healthcare` Docker Compose profile) becomes a secondary feature. A Synthea integration (pre-built sample datasets or a "generate synthetic data" workflow) becomes the primary healthcare onboarding path. The FHIR file format plugin remains useful for parsing Synthea output

## Confirmation

Verify that Synthea-generated FHIR data can be uploaded, modeled, and used to prototype dashboards end-to-end. Confirm that the Mirth Connect integration remains functional as a secondary path for organizations testing with HL7v2 message formats.

## Related

- [ADR-003: DuckDB / pg_duckdb for Analytical Queries](adr-003-duckdb-pg-duckdb-analytics.md) -- synthetic data is queried via DuckDB
