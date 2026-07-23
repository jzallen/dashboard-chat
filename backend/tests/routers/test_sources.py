"""Router-level wiring tests for /api/sources (Source aggregate, slice 1).

Port-to-port through the full ASGI stack (middleware -> router -> controller ->
use case) against the in-memory test session via the get_db override. Auth is
the identity-header + project-access path used by the uploads router.
"""

import pytest
from freezegun import freeze_time
from httpx import ASGITransport, AsyncClient

from app.database import get_db
from app.main import app
from app.repositories.metadata import OrganizationRecord, ProjectRecord
from tests.uuidv7_fixtures import ORG_1, PROJECT_1

IDENTITY_HEADERS = {
    "X-User-Id": "dev-user-001",
    "X-Org-Id": ORG_1,
    "X-User-Email": "dev@localhost",
}


@pytest.fixture
def client(db_session):
    from app.plugins import create_plugin_registry

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.state.plugin_registry = create_plugin_registry()
    transport = ASGITransport(app=app)
    yield AsyncClient(transport=transport, base_url="http://test")
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
async def seeded(db_session):
    db_session.add(OrganizationRecord(id=ORG_1, name="Org 1"))
    db_session.add(ProjectRecord(id=PROJECT_1, name="Test Project", org_id=ORG_1))
    await db_session.flush()
    return db_session


async def test_post_source_creates_and_returns_jsonapi_single(client, seeded):
    async with client:
        res = await client.post(
            "/api/sources",
            json={
                "project_id": PROJECT_1,
                "name": "Patients",
                "schema_config": {"fields": {"patient_id": {"type": "text"}}},
            },
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["data"]["type"] == "sources"
    attrs = body["data"]["attributes"]
    assert attrs["project_id"] == PROJECT_1
    assert attrs["name"] == "Patients"
    assert attrs["schema_config"] == {"fields": {"patient_id": {"type": "text"}}}


async def test_post_source_for_other_org_project_is_forbidden(client, seeded, db_session):
    db_session.add(ProjectRecord(id="019515a0-0004-7000-8000-000000000004", name="Other", org_id="other-org"))
    await db_session.flush()

    async with client:
        res = await client.post(
            "/api/sources",
            json={"project_id": "019515a0-0004-7000-8000-000000000004", "name": "X"},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 403, res.text


async def test_get_sources_lists_for_project(client, seeded):
    async with client:
        await client.post(
            "/api/sources",
            json={"project_id": PROJECT_1, "name": "A"},
            headers=IDENTITY_HEADERS,
        )
        await client.post(
            "/api/sources",
            json={"project_id": PROJECT_1, "name": "B"},
            headers=IDENTITY_HEADERS,
        )
        res = await client.get(
            "/api/sources",
            params={"project_id": PROJECT_1},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    body = res.json()
    names = {item["attributes"]["name"] for item in body["data"]}
    assert names == {"A", "B"}


async def test_get_source_detail_returns_single(client, seeded):
    async with client:
        created = await client.post(
            "/api/sources",
            json={"project_id": PROJECT_1, "name": "Patients"},
            headers=IDENTITY_HEADERS,
        )
        source_id = created.json()["data"]["id"]

        res = await client.get(f"/api/sources/{source_id}", headers=IDENTITY_HEADERS)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["data"]["id"] == source_id
    assert body["data"]["attributes"]["name"] == "Patients"


# ---------------------------------------------------------------------------
# Slice 2 — presigned upload + UI-triggered process
# ---------------------------------------------------------------------------

SAMPLE_CSV = b"name,age,active\nAlice,30,true\nBob,25,false"


@pytest.fixture(autouse=True)
def _s3(mock_s3):
    """Route the default lake repo at moto for the router-level slice-2 tests."""
    yield mock_s3


async def _create_source(client, name="Patients") -> str:
    created = await client.post(
        "/api/sources",
        json={"project_id": PROJECT_1, "name": name},
        headers=IDENTITY_HEADERS,
    )
    return created.json()["data"]["id"]


async def test_record_upload_returns_202_with_presigned_put(client, seeded):
    async with client:
        source_id = await _create_source(client)
        res = await client.post(
            f"/api/sources/{source_id}/uploads",
            json={"filename": "patients.csv", "content_type": "text/csv", "size": len(SAMPLE_CSV)},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 202, res.text
    body = res.json()
    assert body["status"] == "pending"
    assert body["put_url"]
    assert body["storage_key"].endswith("/patients.csv")
    assert body["upload_id"]


async def test_record_upload_for_other_org_source_is_forbidden(client, seeded, db_session):
    other_project = "019515a0-0004-7000-8000-000000000004"
    db_session.add(ProjectRecord(id=other_project, name="Other", org_id="other-org"))
    await db_session.flush()

    async with client:
        # Create a source in the other org directly via repo path is overkill; instead
        # create it through the API as the other org, then attack it from our org.
        other_headers = {**IDENTITY_HEADERS, "X-Org-Id": "other-org"}
        created = await client.post(
            "/api/sources",
            json={"project_id": other_project, "name": "Theirs"},
            headers=other_headers,
        )
        other_source_id = created.json()["data"]["id"]

        res = await client.post(
            f"/api/sources/{other_source_id}/uploads",
            json={"filename": "x.csv", "content_type": "text/csv", "size": 10},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 403, res.text


async def test_process_upload_returns_linked_dataset(client, seeded, mock_s3):
    async with client:
        source_id = await _create_source(client)
        rec = await client.post(
            f"/api/sources/{source_id}/uploads",
            json={"filename": "patients.csv", "content_type": "text/csv", "size": len(SAMPLE_CSV)},
            headers=IDENTITY_HEADERS,
        )
        rec_body = rec.json()
        upload_id = rec_body["upload_id"]

        # Simulate the browser's direct PUT to MinIO. Use the same lake-repo
        # client the read-back path uses so the object lands in the same moto
        # backend (an endpoint-bound boto3 client, not the default mock_s3 one).
        from app.repositories.lake import MinIOLakeRepository

        MinIOLakeRepository().write_raw_file(SAMPLE_CSV, rec_body["storage_key"])

        res = await client.post(
            f"/api/sources/{source_id}/uploads/{upload_id}/process",
            json={},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["data"]["type"] == "datasets"
    assert body["data"]["attributes"]["source_id"] == source_id


# ---------------------------------------------------------------------------
# Slice 5 — subsequent-upload schema-match append + mismatch recovery
# ---------------------------------------------------------------------------

MATCH_CSV = b"name,age,active\nCarol,40,true\nDave,22,false"
MISMATCH_CSV = b"name,age,email\nCarol,40,c@x.com"


async def _record_put_process(client, source_id, raw: bytes, filename: str):
    """Record an upload, simulate the browser PUT to MinIO, then process it."""
    from app.repositories.lake import MinIOLakeRepository

    rec = await client.post(
        f"/api/sources/{source_id}/uploads",
        json={"filename": filename, "content_type": "text/csv", "size": len(raw)},
        headers=IDENTITY_HEADERS,
    )
    rec_body = rec.json()
    MinIOLakeRepository().write_raw_file(raw, rec_body["storage_key"])
    return await client.post(
        f"/api/sources/{source_id}/uploads/{rec_body['upload_id']}/process",
        json={},
        headers=IDENTITY_HEADERS,
    )


async def test_subsequent_matching_upload_returns_200_appended(client, seeded, mock_s3):
    async with client:
        source_id = await _create_source(client)
        first = await _record_put_process(client, source_id, SAMPLE_CSV, "patients.csv")
        assert first.status_code == 200, first.text
        first_dataset_id = first.json()["data"]["id"]

        res = await _record_put_process(client, source_id, MATCH_CSV, "more.csv")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["data"]["type"] == "datasets"
    assert body["data"]["id"] == first_dataset_id
    assert body["data"]["attributes"]["status"] == "appended"


async def test_list_source_uploads_returns_jsonapi_list(client, seeded, mock_s3):
    async with client:
        source_id = await _create_source(client)
        await _record_put_process(client, source_id, SAMPLE_CSV, "patients.csv")

        res = await client.get(f"/api/sources/{source_id}/uploads", headers=IDENTITY_HEADERS)

    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["data"]) == 1
    item = body["data"][0]
    assert item["type"] == "uploads"
    attrs = item["attributes"]
    assert attrs["original_filename"] == "patients.csv"
    assert attrs["status"] == "ingested"
    assert attrs["row_count"] == 2


async def test_list_source_uploads_for_other_org_source_is_forbidden(client, seeded, db_session):
    other_project = "019515a0-0004-7000-8000-000000000004"
    db_session.add(ProjectRecord(id=other_project, name="Other", org_id="other-org"))
    await db_session.flush()

    async with client:
        other_headers = {**IDENTITY_HEADERS, "X-Org-Id": "other-org"}
        created = await client.post(
            "/api/sources",
            json={"project_id": other_project, "name": "Theirs"},
            headers=other_headers,
        )
        other_source_id = created.json()["data"]["id"]

        res = await client.get(f"/api/sources/{other_source_id}/uploads", headers=IDENTITY_HEADERS)

    assert res.status_code == 403, res.text


async def test_subsequent_mismatched_upload_returns_422_with_detail(client, seeded, mock_s3):
    async with client:
        source_id = await _create_source(client)
        await _record_put_process(client, source_id, SAMPLE_CSV, "patients.csv")

        res = await _record_put_process(client, source_id, MISMATCH_CSV, "bad.csv")

    assert res.status_code == 422, res.text
    body = res.json()
    error = body["errors"][0]
    assert "active" in error["detail"]["missing"]
    assert "email" in error["detail"]["extra"]


# ---------------------------------------------------------------------------
# PATCH /api/sources/{id} {archived} — archive a source to Cold Storage
# ---------------------------------------------------------------------------


async def test_patch_archive_returns_source_with_cold_storage_fields(client, seeded):
    async with client:
        with freeze_time("2026-07-22T12:00:00+00:00"):
            source_id = await _create_source(client)

        with freeze_time("2026-08-30T09:00:00+00:00"):
            res = await client.patch(
                f"/api/sources/{source_id}",
                json={"archived": True},
                headers=IDENTITY_HEADERS,
            )

    assert res.status_code == 200, res.text
    assert res.json() == {
        "data": {
            "type": "sources",
            "id": source_id,
            "attributes": {
                "project_id": PROJECT_1,
                "name": "Patients",
                "schema_config": {},
                "created_by": "dev-user-001",
                "created_at": "2026-07-22T12:00:00",
                "updated_at": "2026-08-30T09:00:00",
                "archived_at": "2026-08-30T09:00:00",
                "retention_until": "2026-11-28T09:00:00",
            },
        },
        "links": {"self": f"/api/sources/{source_id}"},
    }


async def test_patch_archive_is_idempotent_preserving_timestamp(client, seeded):
    async with client:
        source_id = await _create_source(client)

        first = await client.patch(f"/api/sources/{source_id}", json={"archived": True}, headers=IDENTITY_HEADERS)
        second = await client.patch(f"/api/sources/{source_id}", json={"archived": True}, headers=IDENTITY_HEADERS)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json() == first.json()


async def test_patch_archive_unknown_source_returns_404(client, seeded):
    async with client:
        res = await client.patch(
            "/api/sources/019515a0-b0ff-7000-8000-0000000000ff",
            json={"archived": True},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 404, res.text


async def test_patch_archive_cross_org_source_is_forbidden(client, seeded, db_session):
    other_project = "019515a0-0004-7000-8000-000000000004"
    db_session.add(ProjectRecord(id=other_project, name="Other", org_id="other-org"))
    await db_session.flush()

    async with client:
        other_headers = {**IDENTITY_HEADERS, "X-Org-Id": "other-org"}
        created = await client.post(
            "/api/sources",
            json={"project_id": other_project, "name": "Theirs"},
            headers=other_headers,
        )
        other_source_id = created.json()["data"]["id"]

        res = await client.patch(
            f"/api/sources/{other_source_id}",
            json={"archived": True},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 403, res.text


async def test_patch_archive_malformed_body_returns_422(client, seeded):
    async with client:
        source_id = await _create_source(client)

        res = await client.patch(
            f"/api/sources/{source_id}",
            json={"archived": "banana"},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 422, res.text


# ---------------------------------------------------------------------------
# Slice 2 — Cold-Storage listing (default-exclude + ?archived=true)
# ---------------------------------------------------------------------------


async def _archive(client, source_id: str) -> None:
    res = await client.patch(f"/api/sources/{source_id}", json={"archived": True}, headers=IDENTITY_HEADERS)
    assert res.status_code == 200, res.text


async def test_get_sources__by_default__excludes_archived(client, seeded):
    async with client:
        active_id = await _create_source(client, name="Active")
        archived_id = await _create_source(client, name="Archived")
        await _archive(client, archived_id)

        res = await client.get("/api/sources", params={"project_id": PROJECT_1}, headers=IDENTITY_HEADERS)

    assert res.status_code == 200, res.text
    assert {item["id"] for item in res.json()["data"]} == {active_id}


async def test_get_sources__when_archived_true__returns_only_cold_storage(client, seeded):
    async with client:
        await _create_source(client, name="Active")
        archived_id = await _create_source(client, name="Archived")
        await _archive(client, archived_id)

        res = await client.get(
            "/api/sources",
            params={"project_id": PROJECT_1, "archived": "true"},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    assert {item["id"] for item in res.json()["data"]} == {archived_id}


async def test_get_source_by_id__when_source_archived__returns_it_unfiltered(client, seeded):
    async with client:
        archived_id = await _create_source(client, name="Archived")
        await _archive(client, archived_id)

        res = await client.get(f"/api/sources/{archived_id}", headers=IDENTITY_HEADERS)

    assert res.status_code == 200, res.text
    assert res.json()["data"]["id"] == archived_id


# ---------------------------------------------------------------------------
# Restore — symmetric PATCH {archived:false} + archive/restore round-trip
# ---------------------------------------------------------------------------


async def test_patch_source__when_archived_false_on_archived_source__clears_cold_storage_fields(client, seeded):
    async with client:
        source_id = await _create_source(client)
        await _archive(client, source_id)

        res = await client.patch(
            f"/api/sources/{source_id}",
            json={"archived": False},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    attrs = res.json()["data"]["attributes"]
    assert (attrs["archived_at"], attrs["retention_until"]) == (None, None)


async def test_patch_source__when_archived_false_on_active_source__leaves_fields_null(client, seeded):
    async with client:
        source_id = await _create_source(client)

        res = await client.patch(
            f"/api/sources/{source_id}",
            json={"archived": False},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 200, res.text
    attrs = res.json()["data"]["attributes"]
    assert (attrs["archived_at"], attrs["retention_until"]) == (None, None)


async def test_patch_source__when_restoring_unknown_source__returns_404(client, seeded):
    async with client:
        res = await client.patch(
            "/api/sources/019515a0-b0ff-7000-8000-0000000000ff",
            json={"archived": False},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 404, res.text


async def test_patch_source__when_restoring_cross_org_source__returns_403(client, seeded, db_session):
    other_project = "019515a0-0004-7000-8000-000000000004"
    db_session.add(ProjectRecord(id=other_project, name="Other", org_id="other-org"))
    await db_session.flush()

    async with client:
        other_headers = {**IDENTITY_HEADERS, "X-Org-Id": "other-org"}
        created = await client.post(
            "/api/sources",
            json={"project_id": other_project, "name": "Theirs"},
            headers=other_headers,
        )
        other_source_id = created.json()["data"]["id"]

        res = await client.patch(
            f"/api/sources/{other_source_id}",
            json={"archived": False},
            headers=IDENTITY_HEADERS,
        )

    assert res.status_code == 403, res.text


async def _list_ids(client, *, archived: bool | None = None) -> set[str]:
    params = {"project_id": PROJECT_1}
    if archived is not None:
        params["archived"] = "true" if archived else "false"
    res = await client.get("/api/sources", params=params, headers=IDENTITY_HEADERS)
    assert res.status_code == 200, res.text
    return {item["id"] for item in res.json()["data"]}


async def test_patch_source__when_archived_then_restored__returns_source_to_active_catalog(client, seeded):
    async with client:
        source_id = await _create_source(client, name="RoundTrip")

        await _archive(client, source_id)
        assert source_id not in await _list_ids(client)
        assert source_id in await _list_ids(client, archived=True)

        restored = await client.patch(
            f"/api/sources/{source_id}",
            json={"archived": False},
            headers=IDENTITY_HEADERS,
        )
        assert restored.status_code == 200, restored.text

        assert source_id in await _list_ids(client)
        assert source_id not in await _list_ids(client, archived=True)
