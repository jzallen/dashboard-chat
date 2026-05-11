"""HTTP + DuckDB driver for the ibis-as-only-sql-compiler acceptance suite.

ADR-026 MR-1 / Phase 01 — DWD-1 (Strategy C, real-local + skip-when-unavailable)
and DWD-2 (new suite, separate pyproject) place the executable acceptance
contracts at ``tests/acceptance/ibis-as-only-sql-compiler/``. The driver
mirrors the v2 dbt-test driver shape (procedural, one method per protocol
step, no probes) and adds DuckDB-level evaluation for the row-equivalence
assertions DWD-3 / DWD-4 require.

The driver is the *port* the BDD step glue lands on; tests above this module
speak in domain terms (an analyst creates a view, the customer's dbt eject
contains a filter, evaluating the SQL returns the right rows).
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb
import httpx


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CreatedDataset:
    """A dataset that has been uploaded; carries the wire shape that views
    need to reference it via ``source_refs``."""

    id: str
    name: str

    def as_source_ref(self) -> dict[str, str]:
        return {"id": self.id, "type": "dataset", "name": self.name}


@dataclass(frozen=True)
class ViewCreateError:
    """Captured HTTP error response when ``create_view`` is expected to fail."""

    status_code: int
    body: dict[str, Any]


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


class ViewAcceptanceDriver:
    """Procedural driver against the compose stack.

    Each public method is one HTTP / DuckDB / filesystem step; tests compose
    the steps to drive a scenario through the production API path. The
    driver owns no state other than the auth-proxy URL and timeout.
    """

    def __init__(
        self,
        *,
        auth_proxy_url: str,
        http_timeout_seconds: float = 30.0,
    ) -> None:
        self._auth_proxy_url = auth_proxy_url.rstrip("/")
        self._timeout = httpx.Timeout(http_timeout_seconds)

    # -- auth ----------------------------------------------------------

    def fetch_dev_jwt(self) -> str:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.post(
                f"{self._auth_proxy_url}/api/auth/callback",
                json={"code": "dev-auth-code"},
            )
            res.raise_for_status()
            token = res.json().get("token")
        if not isinstance(token, str) or not token:
            raise RuntimeError("auth-proxy callback did not return a token")
        return token

    # -- project lifecycle ---------------------------------------------

    def create_project(self, jwt: str, name: str) -> str:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.post(
                f"{self._auth_proxy_url}/api/projects",
                headers=_bearer(jwt, json_body=True),
                json={"name": name},
            )
            res.raise_for_status()
        return _resolve_id(res.json())

    def delete_project(self, jwt: str, project_id: str) -> None:
        with httpx.Client(timeout=self._timeout) as client:
            client.delete(
                f"{self._auth_proxy_url}/api/projects/{project_id}",
                headers=_bearer(jwt),
            )

    # -- datasets ------------------------------------------------------

    def upload_csv(self, jwt: str, project_id: str, csv_path: Path) -> CreatedDataset:
        with httpx.Client(timeout=self._timeout) as client, csv_path.open("rb") as fh:
            res = client.post(
                f"{self._auth_proxy_url}/api/uploads",
                headers=_bearer(jwt),
                files={"file": (csv_path.name, fh.read(), "text/csv")},
                data={"project_id": project_id},
            )
            res.raise_for_status()
        body = res.json()
        dataset_id = _resolve_id(body)
        dataset_name = _resolve_name(body) or csv_path.stem
        return CreatedDataset(id=dataset_id, name=dataset_name)

    def fetch_dataset_schema(self, jwt: str, dataset_id: str) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.get(
                f"{self._auth_proxy_url}/api/datasets/{dataset_id}",
                headers=_bearer(jwt),
            )
            res.raise_for_status()
        body = res.json()
        data = body.get("data", body) if isinstance(body, dict) else {}
        attrs = data.get("attributes", data) if isinstance(data, dict) else {}
        return attrs.get("schema_config") or {"fields": {}}

    # -- views ---------------------------------------------------------

    def create_view(
        self,
        jwt: str,
        project_id: str,
        *,
        name: str,
        source_refs: list[dict[str, str]],
        columns: list[dict[str, Any]] | None = None,
        joins: list[dict[str, Any]] | None = None,
        filters: list[dict[str, Any]] | None = None,
        sql_definition: str = "",
    ) -> dict[str, Any]:
        body = {
            "name": name,
            "sql_definition": sql_definition,
            "source_refs": source_refs,
            "columns": columns or [],
            "joins": joins or [],
            "filters": filters or [],
        }
        with httpx.Client(timeout=self._timeout) as client:
            res = client.post(
                f"{self._auth_proxy_url}/api/projects/{project_id}/views",
                headers=_bearer(jwt, json_body=True),
                json=body,
            )
            res.raise_for_status()
        return res.json()["data"]

    def try_create_view(
        self,
        jwt: str,
        project_id: str,
        *,
        name: str,
        source_refs: list[dict[str, str]],
        filters: list[dict[str, Any]] | None = None,
        columns: list[dict[str, Any]] | None = None,
    ) -> ViewCreateError | dict[str, Any]:
        """Like :meth:`create_view` but returns the error envelope when the
        backend rejects the request. Used by input-validation scenarios that
        need to observe the 4xx body shape."""
        body = {
            "name": name,
            "sql_definition": "",
            "source_refs": source_refs,
            "columns": columns or [],
            "joins": [],
            "filters": filters or [],
        }
        with httpx.Client(timeout=self._timeout) as client:
            res = client.post(
                f"{self._auth_proxy_url}/api/projects/{project_id}/views",
                headers=_bearer(jwt, json_body=True),
                json=body,
            )
        if res.status_code >= 400:
            try:
                err_body = res.json()
            except Exception:
                err_body = {"error": res.text}
            return ViewCreateError(status_code=res.status_code, body=err_body)
        return res.json()["data"]

    def list_views(self, jwt: str, project_id: str) -> list[dict[str, Any]]:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.get(
                f"{self._auth_proxy_url}/api/projects/{project_id}/views",
                headers=_bearer(jwt),
            )
            res.raise_for_status()
        body = res.json()
        return body.get("data", []) if isinstance(body, dict) else []

    def get_view(self, jwt: str, project_id: str, view_id: str) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.get(
                f"{self._auth_proxy_url}/api/projects/{project_id}/views/{view_id}",
                headers=_bearer(jwt),
            )
            res.raise_for_status()
        return res.json()["data"]

    # -- dbt eject -----------------------------------------------------

    def export_dbt_zip(self, jwt: str, project_id: str) -> bytes:
        with httpx.Client(timeout=self._timeout) as client:
            res = client.get(
                f"{self._auth_proxy_url}/api/projects/{project_id}/export/dbt",
                headers=_bearer(jwt),
            )
            res.raise_for_status()
            return res.content

    def read_intermediate_sql(self, zip_bytes: bytes, intermediate_name: str) -> str:
        """Read one ``models/intermediate/<name>.sql`` file out of the export.

        ``intermediate_name`` is the snake-cased view name without the
        ``int_`` prefix or the ``.sql`` suffix; the function tries both
        ``int_<name>.sql`` and ``<name>.sql`` to be tolerant of dbt-naming
        evolution.
        """
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            candidates = [
                f"models/intermediate/int_{intermediate_name}.sql",
                f"models/intermediate/{intermediate_name}.sql",
            ]
            for entry in names:
                for candidate in candidates:
                    if entry.endswith(candidate):
                        return zf.read(entry).decode("utf-8")
        raise RuntimeError(
            f"intermediate model not found in export; looked for {candidates!r}, "
            f"export contains {[n for n in names if 'intermediate' in n]!r}"
        )

    # -- DuckDB evaluation --------------------------------------------

    def evaluate_view_sql(
        self,
        sql: str,
        *,
        seed_relations: dict[str, Path],
        source_name_map: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        """Evaluate ``sql`` against in-memory DuckDB with CSV fixtures registered as tables.

        ``seed_relations`` maps the table identifier referenced in the SQL to
        the on-disk CSV file. ``source_name_map`` allows callers to register
        the same fixture under multiple aliases (e.g. when the rendered SQL
        names the relation ``"orders"`` and the dbt eject names it ``stg_orders``).
        """
        con = duckdb.connect(":memory:")
        try:
            for table_name, csv_path in seed_relations.items():
                con.execute(
                    f"CREATE TABLE {duckdb_quote(table_name)} AS "
                    f"SELECT * FROM read_csv_auto({duckdb_quote_string(str(csv_path))})"
                )
            if source_name_map:
                for alias, source_name in source_name_map.items():
                    con.execute(
                        f"CREATE VIEW {duckdb_quote(alias)} AS "
                        f"SELECT * FROM {duckdb_quote(source_name)}"
                    )
            rows = con.execute(sql).fetchall()
            cols = [d[0] for d in con.description]
        finally:
            con.close()
        return [dict(zip(cols, row, strict=True)) for row in rows]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def duckdb_quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def duckdb_quote_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _bearer(token: str, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _resolve_id(body: Any) -> str:
    if isinstance(body, dict):
        data = body.get("data", body)
        if isinstance(data, dict):
            ident = data.get("id") or data.get("attributes", {}).get("id")
            if isinstance(ident, str) and ident:
                return ident
    raise RuntimeError(f"could not resolve id from response: {body!r}")


def _resolve_name(body: Any) -> str | None:
    if isinstance(body, dict):
        data = body.get("data", body)
        if isinstance(data, dict):
            attrs = data.get("attributes", data)
            if isinstance(attrs, dict):
                name = attrs.get("name")
                if isinstance(name, str) and name:
                    return name
    return None


def find_quoted_substring(haystack: str, needle: str) -> bool:
    """True when ``needle`` appears as a SQL string literal inside ``haystack``.

    SQL escapes single quotes by doubling them (``''``); ibis renders payloads
    with embedded quotes the same way. The function inspects either form so
    contract assertions stay legible.
    """
    if needle in haystack:
        return True
    escaped = needle.replace("'", "''")
    return escaped in haystack


def normalize_for_predicate(sql: str) -> str:
    """Collapse whitespace so substring predicate searches survive
    pretty-printed SQL line breaks.
    """
    return " ".join(sql.split())


def predicate_present(sql: str, *fragments: Iterable[str]) -> bool:
    """Each ``fragments`` element must appear (case-insensitive) in the
    whitespace-normalized SQL — used by the structural assertions that say
    "WHERE clause restricts region to west" without coupling to ibis's exact
    rendering."""
    flat = normalize_for_predicate(sql).lower()
    return all(str(f).lower() in flat for f in fragments)
