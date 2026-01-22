"""API routes for data queries (DuckDB or PostgreSQL)."""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..services.duckdb_service import (
    query_table,
    list_tables,
    get_table_schema,
    create_sample_database,
    DATA_DIR,
)

router = APIRouter(prefix="/api/data", tags=["data"])


class QueryRequest(BaseModel):
    """Request for executing a custom query."""

    query: str
    limit: int = 1000
    offset: int = 0


class QueryResponse(BaseModel):
    """Response from a data query."""

    rows: list[dict[str, Any]]
    columns: list[str]
    total_count: int
    limit: int
    offset: int


class TableListResponse(BaseModel):
    """Response listing available tables."""

    database: str
    tables: list[str]


class SchemaResponse(BaseModel):
    """Response with table schema."""

    table: str
    schema_config: dict[str, Any]


@router.get("/tables", response_model=TableListResponse)
async def get_tables(
    db_file: str = Query(default="sample.duckdb", description="DuckDB file name"),
):
    """List all tables in a DuckDB database."""
    db_path = DATA_DIR / db_file
    if not db_path.exists():
        # Create sample database if it doesn't exist
        if db_file == "sample.duckdb":
            create_sample_database(db_path)
        else:
            raise HTTPException(status_code=404, detail=f"Database file not found: {db_file}")

    tables = list_tables(db_path)
    return TableListResponse(database=db_file, tables=tables)


@router.get("/query", response_model=QueryResponse)
async def query_data(
    db_file: str = Query(default="sample.duckdb", description="DuckDB file name"),
    table: str = Query(default=None, description="Table to query"),
    limit: int = Query(default=100, ge=1, le=10000),
    offset: int = Query(default=0, ge=0),
):
    """Query data from a DuckDB table.

    If no table is specified, queries the first available table.
    """
    db_path = DATA_DIR / db_file
    if not db_path.exists():
        if db_file == "sample.duckdb":
            create_sample_database(db_path)
        else:
            raise HTTPException(status_code=404, detail=f"Database file not found: {db_file}")

    try:
        rows, columns, total = query_table(db_path, table_name=table, limit=limit, offset=offset)
        return QueryResponse(
            rows=rows,
            columns=columns,
            total_count=total,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query", response_model=QueryResponse)
async def execute_query(
    request: QueryRequest,
    db_file: str = Query(default="sample.duckdb", description="DuckDB file name"),
):
    """Execute a custom SQL query against a DuckDB database."""
    db_path = DATA_DIR / db_file
    if not db_path.exists():
        if db_file == "sample.duckdb":
            create_sample_database(db_path)
        else:
            raise HTTPException(status_code=404, detail=f"Database file not found: {db_file}")

    try:
        rows, columns, total = query_table(
            db_path,
            query=request.query,
            limit=request.limit,
            offset=request.offset,
        )
        return QueryResponse(
            rows=rows,
            columns=columns,
            total_count=total,
            limit=request.limit,
            offset=request.offset,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/schema/{table}", response_model=SchemaResponse)
async def get_schema(
    table: str,
    db_file: str = Query(default="sample.duckdb", description="DuckDB file name"),
):
    """Get the RAQB-compatible schema for a table."""
    db_path = DATA_DIR / db_file
    if not db_path.exists():
        if db_file == "sample.duckdb":
            create_sample_database(db_path)
        else:
            raise HTTPException(status_code=404, detail=f"Database file not found: {db_file}")

    try:
        schema = get_table_schema(db_path, table)
        return SchemaResponse(table=table, schema_config=schema)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/init-sample")
async def init_sample_database():
    """Initialize/reset the sample DuckDB database with test data."""
    try:
        db_path = create_sample_database()
        tables = list_tables(db_path)
        rows, _, total = query_table(db_path, table_name="products", limit=10)
        return {
            "status": "created",
            "database": str(db_path),
            "tables": tables,
            "sample_rows": rows,
            "total_count": total,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
