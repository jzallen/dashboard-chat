"""Builder for SQL-access connection-response dicts.

Pure helper that assembles the dict returned to API callers by
enable_sql_access, regenerate_sql_credentials, and get_sql_access.

The password and connection_string fields are both-or-neither:
- password is None: both keys are omitted
- password provided: both keys are included, with connection_string
  rendered in PostgreSQL DSN form

Extras are merged on top of the core fields. Callers are responsible
for any key collisions.
"""


def build_connection_response(
    engine_node,
    schema: str,
    username: str,
    *,
    password: str | None = None,
    extras: dict | None = None,
) -> dict:
    """Assemble the SQL-access connection response.

    Args:
        engine_node: object with ``host``, ``port``, and ``database`` attrs.
        schema: PostgreSQL schema exposed to the caller.
        username: role used to connect (proxy role in production).
        password: one-time plaintext password. When provided, the response
            also includes a ``connection_string`` DSN. When None, both
            ``password`` and ``connection_string`` are omitted.
        extras: additional keys to merge into the response (e.g. ``enabled``,
            ``engine_node_id``, per-dataset sync status). Extras keys override
            core keys on collision.

    Returns:
        dict containing core connection fields plus any extras and, when
        ``password`` is provided, ``password`` and ``connection_string``.
    """
    response: dict = {
        "host": engine_node.host,
        "port": engine_node.port,
        "database": engine_node.database,
        "username": username,
        "schema": schema,
    }

    if password is not None:
        response["password"] = password
        response["connection_string"] = (
            f"postgresql://{username}:{password}"
            f"@{engine_node.host}:{engine_node.port}/{engine_node.database}"
        )

    if extras:
        response.update(extras)

    return response
