"""Milestone-1 @input_validation_contract: malformed operators are rejected.

A view filter submitted with an operator outside the canonical 12-operator
set must be rejected by the validation boundary BEFORE the compiler is
reached. The contract surface is the HTTP error envelope: a structured
4xx response naming the operator field, with no view persisted.
"""

from __future__ import annotations

import pytest

from driver import CreatedDataset, ViewAcceptanceDriver, ViewCreateError

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.milestone_1,
    pytest.mark.input_validation_contract,
]


def test_malformed_operator_is_rejected_before_compiler(
    driver: ViewAcceptanceDriver,
    jwt: str,
    project: str,
    orders_dataset: CreatedDataset,
) -> None:
    pre_views = driver.list_views(jwt, project)
    pre_count = len(pre_views)

    result = driver.try_create_view(
        jwt,
        project,
        name="rejected_view",
        source_refs=[orders_dataset.as_source_ref()],
        columns=[
            {
                "name": "region",
                "source_ref": orders_dataset.id,
                "source_column": "region",
                "display_type": "text",
            }
        ],
        filters=[
            {
                "source_ref": orders_dataset.id,
                "column": "region",
                "operator": "DELETE_ALL",
                "value": "x",
            }
        ],
    )

    assert isinstance(result, ViewCreateError), (
        f"expected the malformed-operator request to be rejected; got "
        f"successful response: {result}"
    )
    assert 400 <= result.status_code < 500, (
        f"expected 4xx; got {result.status_code} body={result.body}"
    )
    # The error envelope mentions the operator field — either by named field
    # ("operator") or by surfacing the discriminator info.
    body_text = str(result.body).lower()
    assert "operator" in body_text, result.body

    # No view persisted — the count is unchanged after the failed request.
    post_views = driver.list_views(jwt, project)
    assert len(post_views) == pre_count, (
        f"a view was persisted despite the malformed-operator rejection:\n"
        f"before: {pre_views}\nafter: {post_views}"
    )
