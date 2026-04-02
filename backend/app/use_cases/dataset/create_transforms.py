"""Create transforms use case — batch create transforms on a dataset."""

from typing import TYPE_CHECKING, Any

from returns.result import Result

from app.repositories import with_repositories
from app.types import CleaningExpression
from app.use_cases import handle_returns
from app.use_cases.dataset.dataset_service import DatasetService

if TYPE_CHECKING:
    from app.repositories import RepositoryContainer


@handle_returns
@with_repositories
async def create_transforms(
    dataset_id: str,
    transforms_input: list[dict[str, Any]],
    *,
    repositories: "RepositoryContainer",
) -> Result[None, str]:
    """Batch-create transforms on a dataset.

    Raises:
        DatasetNotFound: If dataset with given ID does not exist.
        AuthorizationError: If user's org does not own the parent project.
    """
    metadata_repo = repositories.metadata
    outbox_repo = repositories.outbox

    service = DatasetService(repositories)
    await service.fetch_dataset_record(dataset_id)

    # Server-side expression_sql generation for non-filter transforms (design D1)
    for t in transforms_input:
        transform_type = t.get("transform_type", "filter")
        if transform_type != "filter" and t.get("expression_config"):
            expr = CleaningExpression(t["expression_config"])
            column = t.get("target_column", "")
            # Always overwrite client-provided expression_sql with server-generated value
            t["expression_sql"] = expr.to_display_sql(column)

    created = await metadata_repo.create_transforms_batch(dataset_id, transforms_input)

    await outbox_repo.submit_transforms_created_event(
        dataset_id=dataset_id,
        transforms=created,
    )
