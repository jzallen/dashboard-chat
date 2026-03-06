"""Dependency tracking for views.

Provides validation of source references and circular dependency detection
for the view dependency graph.
"""

from .exceptions import CircularDependency, InvalidSourceReference


class DependencyService:
    """Service for validating view dependencies."""

    def __init__(self, metadata_repo):
        self._repo = metadata_repo

    async def validate_source_refs(self, source_refs: list[dict], project_id: str) -> None:
        """Validate all referenced IDs exist in the same project.

        Args:
            source_refs: List of source reference dicts with 'id' and 'type' keys.
            project_id: The project ID to validate references within.

        Raises:
            InvalidSourceReference: If any referenced IDs do not exist.
        """
        missing = []
        for ref in source_refs:
            ref_id = ref["id"]
            ref_type = ref["type"]
            if ref_type == "dataset":
                if not await self._repo.dataset_exists(ref_id):
                    missing.append(ref_id)
            elif ref_type == "view":
                if not await self._repo.view_exists(ref_id):
                    missing.append(ref_id)
        if missing:
            raise InvalidSourceReference(missing)

    async def check_circular_dependencies(self, view_id: str, source_refs: list[dict]) -> None:
        """DFS to detect cycles in the view dependency graph.

        Args:
            view_id: The view being created/updated (the target node).
            source_refs: The proposed source references for this view.

        Raises:
            CircularDependency: If a cycle would be created.
        """
        visited = set()

        async def dfs(current_refs: list[dict]) -> None:
            for ref in current_refs:
                if ref["type"] != "view":
                    continue  # Datasets terminate traversal
                ref_id = ref["id"]
                if ref_id == view_id:
                    raise CircularDependency(view_id)
                if ref_id in visited:
                    continue
                visited.add(ref_id)
                view_dict = await self._repo.get_view(ref_id)
                if view_dict:
                    await dfs(view_dict.get("source_refs", []))

        await dfs(source_refs)
