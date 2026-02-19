import yaml


def generate_profiles_yml(project_name_snake: str) -> str:
    """Generate profiles.yml with DuckDB target and S3 env_var placeholders."""
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
                        "s3_url_style": "{{ env_var('S3_URL_STYLE', 'vhost') }}",
                    },
                }
            },
        }
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
