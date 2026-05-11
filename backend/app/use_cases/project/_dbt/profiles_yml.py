import yaml


def generate_profiles_yml(project_name_snake: str) -> str:
    """Generate profiles.yml with DuckDB (dev) and PostgreSQL (postgres) targets.

    The default target is 'dev' (DuckDB in-memory with S3 access via httpfs).
    The 'postgres' target connects to an external PostgreSQL database.
    Both targets use env_var Jinja placeholders so no real credentials are embedded.
    """
    config = {
        project_name_snake: {
            "target": "dev",
            "outputs": {
                "dev": {
                    "type": "duckdb",
                    "path": ":memory:",
                    "extensions": ["httpfs"],
                    "settings": {
                        "s3_region": "{{ env_var('S3_REGION', 'us-east-1') }}",
                        "s3_access_key_id": "{{ env_var('S3_ACCESS_KEY_ID') }}",
                        "s3_secret_access_key": "{{ env_var('S3_SECRET_ACCESS_KEY') }}",
                        "s3_endpoint": "{{ env_var('S3_ENDPOINT', '') }}",
                        "s3_use_ssl": "{{ env_var('S3_USE_SSL', 'true') | as_bool }}",
                        "s3_url_style": "{{ env_var('S3_URL_STYLE', 'vhost') }}",
                    },
                },
                "postgres": {
                    "type": "postgres",
                    "host": "{{ env_var('PG_HOST', 'localhost') }}",
                    "port": "{{ env_var('PG_PORT', '5433') | int }}",
                    "user": "{{ env_var('PG_USER') }}",
                    "password": "{{ env_var('PG_PASSWORD') }}",
                    "dbname": "{{ env_var('PG_DATABASE', 'dashboard_external') }}",
                    "schema": "{{ env_var('PG_SCHEMA', 'public') }}",
                },
            },
        }
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
