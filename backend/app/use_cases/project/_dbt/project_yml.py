import yaml


def generate_project_yml(project_name_snake: str) -> str:
    """Generate dbt_project.yml content."""
    config = {
        "name": project_name_snake,
        "version": "1.0.0",
        "profile": project_name_snake,
        "model-paths": ["models"],
        "macro-paths": ["macros"],
        "on-run-start": ["{{ register_custom_functions() }}"],
    }
    return yaml.dump(config, default_flow_style=False, sort_keys=False)
