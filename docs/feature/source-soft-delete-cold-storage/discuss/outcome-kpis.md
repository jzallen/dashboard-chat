# Outcome KPIs — source-soft-delete-cold-storage

| KPI | Target | Measurement method |
|-----|--------|--------------------|
| Archive-a-source success rate | ≥ 99% of `PATCH {archived:true}` calls on a valid own-org source return `200` (0% 404 for the DC-195 mismatch class) | Backend request logs / acceptance suite: assert no `/api/datasets/{sourceId}/archive` 404s originate from source archival |
| Read-contract fidelity | 100% of source responses expose `archived_at` + `retention_until` | Contract test on `Source.serialize()` and the source response schema |
| Active-catalog cleanliness | `GET /api/sources` returns 0 archived sources by default | List-endpoint test asserting `archived_at IS NULL` on every returned row |
| Round-trip recoverability | 100% archive→restore round-trips return the source to active listing with cleared lifecycle fields | Round-trip acceptance test (Slice 3) |
| No unintended data loss | 0 child datasets archived/deleted as a side effect of source archival | Assertion in Slice 1 test that dependent dataset rows are untouched |

**Measurement window**: acceptance suite at merge time; production logs monitored for the
first release cycle after UI wiring lands (separate follow-up).
