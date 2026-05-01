from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field
import json
from .. import types

from ..types import UNSET, Unset

from ..types import File, FileTypes
from ..types import UNSET, Unset
from io import BytesIO
from typing import cast


T = TypeVar("T", bound="BodyUploadFileApiUploadsPost")


@_attrs_define
class BodyUploadFileApiUploadsPost:
    """
    Attributes:
        file (File):
        project_id (str):
        dataset_id (None | str | Unset):
    """

    file: File
    project_id: str
    dataset_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file = self.file.to_tuple()

        project_id = self.project_id

        dataset_id: None | str | Unset
        if isinstance(self.dataset_id, Unset):
            dataset_id = UNSET
        else:
            dataset_id = self.dataset_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "file": file,
                "project_id": project_id,
            }
        )
        if dataset_id is not UNSET:
            field_dict["dataset_id"] = dataset_id

        return field_dict

    def to_multipart(self) -> types.RequestFiles:
        files: types.RequestFiles = []

        files.append(("file", self.file.to_tuple()))

        files.append(("project_id", (None, str(self.project_id).encode(), "text/plain")))

        if not isinstance(self.dataset_id, Unset):
            if isinstance(self.dataset_id, str):
                files.append(("dataset_id", (None, str(self.dataset_id).encode(), "text/plain")))
            else:
                files.append(("dataset_id", (None, str(self.dataset_id).encode(), "text/plain")))

        for prop_name, prop in self.additional_properties.items():
            files.append((prop_name, (None, str(prop).encode(), "text/plain")))

        return files

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = File(payload=BytesIO(d.pop("file")))

        project_id = d.pop("project_id")

        def _parse_dataset_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        dataset_id = _parse_dataset_id(d.pop("dataset_id", UNSET))

        body_upload_file_api_uploads_post = cls(
            file=file,
            project_id=project_id,
            dataset_id=dataset_id,
        )

        body_upload_file_api_uploads_post.additional_properties = d
        return body_upload_file_api_uploads_post

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
