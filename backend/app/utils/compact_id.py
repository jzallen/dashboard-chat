"""Utility for generating compact IDs from UUIDs."""


def compact_id(uuid_str: str) -> str:
    """Strip hyphens from a UUID to produce a compact 32-char hex string."""
    return uuid_str.replace("-", "")


def memory_channel_id(org_id: str, project_id: str) -> str:
    """Generate a deterministic Stream channel ID for a project memory."""
    return f"proj_{compact_id(org_id)}_{compact_id(project_id)}"
