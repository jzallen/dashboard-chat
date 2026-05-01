from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from typing import cast

if TYPE_CHECKING:
    from ..models.transform_create import TransformCreate


T = TypeVar("T", bound="TransformCreateBatch")


@_attrs_define
class TransformCreateBatch:
    """Request body for POST /datasets/:id/transforms — batch create.

    Attributes:
        transforms (list[TransformCreate]):
    """

    transforms: list[TransformCreate]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.transform_create import TransformCreate

        transforms = []
        for transforms_item_data in self.transforms:
            transforms_item = transforms_item_data.to_dict()
            transforms.append(transforms_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "transforms": transforms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.transform_create import TransformCreate

        d = dict(src_dict)
        transforms = []
        _transforms = d.pop("transforms")
        for transforms_item_data in _transforms:
            transforms_item = TransformCreate.from_dict(transforms_item_data)

            transforms.append(transforms_item)

        transform_create_batch = cls(
            transforms=transforms,
        )

        transform_create_batch.additional_properties = d
        return transform_create_batch

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
