from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast


T = TypeVar("T", bound="DatasetCreate")


@_attrs_define
class DatasetCreate:
    """Schema for creating a Dataset from an upload.

    Step 2 of the upload flow: Only upload_id is required.
    Dataset name defaults to 'New Dataset' (business rule on domain model).

        Attributes:
            upload_id (str):
            description (None | str | Unset):
            partition_fields (list[str] | Unset):
    """

    upload_id: str
    description: None | str | Unset = UNSET
    partition_fields: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        upload_id = self.upload_id

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        partition_fields: list[str] | Unset = UNSET
        if not isinstance(self.partition_fields, Unset):
            partition_fields = self.partition_fields

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "upload_id": upload_id,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if partition_fields is not UNSET:
            field_dict["partition_fields"] = partition_fields

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        upload_id = d.pop("upload_id")

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        partition_fields = cast(list[str], d.pop("partition_fields", UNSET))

        dataset_create = cls(
            upload_id=upload_id,
            description=description,
            partition_fields=partition_fields,
        )

        dataset_create.additional_properties = d
        return dataset_create

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
