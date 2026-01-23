"""DuckDB service for local file-based data queries.

Provides lightweight local data access without requiring PostgreSQL.
"""

import duckdb
from pathlib import Path
from typing import Any


# Default data directory
DATA_DIR = Path(__file__).parent.parent.parent / "data"


def ensure_data_dir() -> Path:
    """Ensure the data directory exists."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR


def get_connection(db_path: str | Path | None = None) -> duckdb.DuckDBPyConnection:
    """Get a DuckDB connection.

    Args:
        db_path: Path to DuckDB file, or None for in-memory

    Returns:
        DuckDB connection
    """
    if db_path:
        return duckdb.connect(str(db_path))
    return duckdb.connect()


def list_tables(db_path: str | Path) -> list[str]:
    """List all tables in a DuckDB file.

    Args:
        db_path: Path to DuckDB file

    Returns:
        List of table names
    """
    conn = get_connection(db_path)
    try:
        result = conn.execute("SHOW TABLES").fetchall()
        return [row[0] for row in result]
    finally:
        conn.close()


def query_table(
    db_path: str | Path,
    table_name: str | None = None,
    query: str | None = None,
    where_clause: str | None = None,
    limit: int = 1000,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], list[str], int]:
    """Query data from a DuckDB table.

    Args:
        db_path: Path to DuckDB file
        table_name: Table to query (used if query is None)
        query: Custom SQL query (overrides table_name)
        where_clause: SQL WHERE clause to apply (without WHERE keyword)
        limit: Maximum rows to return
        offset: Row offset for pagination

    Returns:
        Tuple of (rows as dicts, column names, total count)
    """
    conn = get_connection(db_path)
    try:
        if query:
            base_query = query
        elif table_name:
            base_query = f'SELECT * FROM "{table_name}"'
            if where_clause:
                base_query = f'{base_query} WHERE {where_clause}'
        else:
            tables = list_tables(db_path)
            if not tables:
                return [], [], 0
            base_query = f'SELECT * FROM "{tables[0]}"'

        count_query = f"SELECT COUNT(*) FROM ({base_query}) AS subq"
        total_count = conn.execute(count_query).fetchone()[0]

        paginated_query = f"{base_query} LIMIT {limit} OFFSET {offset}"
        result = conn.execute(paginated_query)

        columns = [desc[0] for desc in result.description]
        rows = [dict(zip(columns, row)) for row in result.fetchall()]

        return rows, columns, total_count
    finally:
        conn.close()


def get_table_schema(db_path: str | Path, table_name: str) -> dict[str, Any]:
    """Get schema information for a table.

    Args:
        db_path: Path to DuckDB file
        table_name: Table to describe

    Returns:
        Schema config in RAQB-compatible format
    """
    conn = get_connection(db_path)
    try:
        # Get column info
        result = conn.execute(f'DESCRIBE "{table_name}"').fetchall()

        fields = {}
        for row in result:
            col_name = row[0]
            col_type = row[1].upper()

            # Map DuckDB types to RAQB types
            if "INT" in col_type or "DECIMAL" in col_type or "FLOAT" in col_type or "DOUBLE" in col_type:
                raqb_type = "number"
                operators = ["equal", "not_equal", "less", "less_or_equal",
                            "greater", "greater_or_equal", "between", "is_null", "is_not_null"]
            elif "BOOL" in col_type:
                raqb_type = "boolean"
                operators = ["equal", "not_equal"]
            elif "DATE" in col_type or "TIME" in col_type:
                raqb_type = "datetime"
                operators = ["equal", "not_equal", "less", "less_or_equal",
                            "greater", "greater_or_equal", "between", "is_null", "is_not_null"]
            else:
                raqb_type = "text"
                operators = ["equal", "not_equal", "like", "not_like",
                            "starts_with", "ends_with", "is_empty", "is_not_empty"]

            fields[col_name] = {
                "label": col_name,
                "type": raqb_type,
                "operators": operators,
                "nullable": True,
            }

        return {"fields": fields}
    finally:
        conn.close()


def create_sample_database(db_path: str | Path | None = None) -> Path:
    """Create a sample DuckDB database with test data.

    Args:
        db_path: Path for the database file, or None for default

    Returns:
        Path to the created database
    """
    if db_path is None:
        ensure_data_dir()
        db_path = DATA_DIR / "sample.duckdb"

    conn = get_connection(db_path)
    try:
        # Create products table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                name VARCHAR NOT NULL,
                category VARCHAR NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                quantity INTEGER NOT NULL,
                in_stock BOOLEAN NOT NULL
            )
        """)

        # Check if data already exists
        count = conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        if count == 0:
            # Insert sample data
            conn.execute("""
                INSERT INTO products (id, name, category, amount, quantity, in_stock) VALUES
                (1, 'Widget A', 'Electronics', 29.99, 150, true),
                (2, 'Widget B', 'Electronics', 49.99, 75, true),
                (3, 'Gadget X', 'Accessories', 15.00, 200, true),
                (4, 'Gadget Y', 'Accessories', 8.50, 0, false),
                (5, 'Tool Alpha', 'Hardware', 125.00, 30, true),
                (6, 'Tool Beta', 'Hardware', 89.99, 45, true),
                (7, 'Part 101', 'Components', 2.50, 500, true),
                (8, 'Part 102', 'Components', 3.75, 0, false),
                (9, 'Device Pro', 'Electronics', 299.99, 12, true),
                (10, 'Device Lite', 'Electronics', 149.99, 0, false)
            """)

        return Path(db_path)
    finally:
        conn.close()


def import_csv_to_duckdb(
    csv_path: str | Path,
    db_path: str | Path,
    table_name: str,
) -> int:
    """Import a CSV file into a DuckDB table.

    Args:
        csv_path: Path to CSV file
        db_path: Path to DuckDB file
        table_name: Name for the new table

    Returns:
        Number of rows imported
    """
    conn = get_connection(db_path)
    try:
        # Create table from CSV
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS "{table_name}" AS
            SELECT * FROM read_csv_auto('{csv_path}')
        """)

        # Get row count
        count = conn.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
        return count
    finally:
        conn.close()
