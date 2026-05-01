from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
    from ..models.preview_request_expression_config import PreviewRequestExpressionConfig


T = TypeVar("T", bound="PreviewRequest")


@_attrs_define
class PreviewRequest:
    """Request body for POST /datasets/:id/transforms/preview.

    Attributes:
        expression_config (PreviewRequestExpressionConfig):
        target_column (str):
        transform_type (str):
    """

    expression_config: PreviewRequestExpressionConfig
    target_column: str
    transform_type: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.preview_request_expression_config import PreviewRequestExpressionConfig

        expression_config = self.expression_config.to_dict()

        target_column = self.target_column

        transform_type = self.transform_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "expression_config": expression_config,
                "target_column": target_column,
                "transform_type": transform_type,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.preview_request_expression_config import PreviewRequestExpressionConfig

        d = dict(src_dict)
        expression_config = PreviewRequestExpressionConfig.from_dict(d.pop("expression_config"))

        target_column = d.pop("target_column")

        transform_type = d.pop("transform_type")

        preview_request = cls(
            expression_config=expression_config,
            target_column=target_column,
            transform_type=transform_type,
        )

        preview_request.additional_properties = d
        return preview_request

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
