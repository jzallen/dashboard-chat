from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
    from ..models.report_create_columns_metadata_item import ReportCreateColumnsMetadataItem
    from ..models.report_create_source_refs_item import ReportCreateSourceRefsItem


T = TypeVar("T", bound="ReportCreate")


@_attrs_define
class ReportCreate:
    """Schema for creating a new report.

    Attributes:
        name (str):
        report_type (str):
        sql_definition (str):
        columns_metadata (list[ReportCreateColumnsMetadataItem] | Unset):
        description (None | str | Unset):
        domain (str | Unset):  Default: 'Organization'.
        materialization (str | Unset):  Default: 'view'.
        source_refs (list[ReportCreateSourceRefsItem] | Unset):
    """

    name: str
    report_type: str
    sql_definition: str
    columns_metadata: list[ReportCreateColumnsMetadataItem] | Unset = UNSET
    description: None | str | Unset = UNSET
    domain: str | Unset = "Organization"
    materialization: str | Unset = "view"
    source_refs: list[ReportCreateSourceRefsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.report_create_columns_metadata_item import ReportCreateColumnsMetadataItem
        from ..models.report_create_source_refs_item import ReportCreateSourceRefsItem

        name = self.name

        report_type = self.report_type

        sql_definition = self.sql_definition

        columns_metadata: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.columns_metadata, Unset):
            columns_metadata = []
            for columns_metadata_item_data in self.columns_metadata:
                columns_metadata_item = columns_metadata_item_data.to_dict()
                columns_metadata.append(columns_metadata_item)

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        domain = self.domain

        materialization = self.materialization

        source_refs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.source_refs, Unset):
            source_refs = []
            for source_refs_item_data in self.source_refs:
                source_refs_item = source_refs_item_data.to_dict()
                source_refs.append(source_refs_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "report_type": report_type,
                "sql_definition": sql_definition,
            }
        )
        if columns_metadata is not UNSET:
            field_dict["columns_metadata"] = columns_metadata
        if description is not UNSET:
            field_dict["description"] = description
        if domain is not UNSET:
            field_dict["domain"] = domain
        if materialization is not UNSET:
            field_dict["materialization"] = materialization
        if source_refs is not UNSET:
            field_dict["source_refs"] = source_refs

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.report_create_columns_metadata_item import ReportCreateColumnsMetadataItem
        from ..models.report_create_source_refs_item import ReportCreateSourceRefsItem

        d = dict(src_dict)
        name = d.pop("name")

        report_type = d.pop("report_type")

        sql_definition = d.pop("sql_definition")

        _columns_metadata = d.pop("columns_metadata", UNSET)
        columns_metadata: list[ReportCreateColumnsMetadataItem] | Unset = UNSET
        if _columns_metadata is not UNSET:
            columns_metadata = []
            for columns_metadata_item_data in _columns_metadata:
                columns_metadata_item = ReportCreateColumnsMetadataItem.from_dict(
                    columns_metadata_item_data
                )

                columns_metadata.append(columns_metadata_item)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        domain = d.pop("domain", UNSET)

        materialization = d.pop("materialization", UNSET)

        _source_refs = d.pop("source_refs", UNSET)
        source_refs: list[ReportCreateSourceRefsItem] | Unset = UNSET
        if _source_refs is not UNSET:
            source_refs = []
            for source_refs_item_data in _source_refs:
                source_refs_item = ReportCreateSourceRefsItem.from_dict(source_refs_item_data)

                source_refs.append(source_refs_item)

        report_create = cls(
            name=name,
            report_type=report_type,
            sql_definition=sql_definition,
            columns_metadata=columns_metadata,
            description=description,
            domain=domain,
            materialization=materialization,
            source_refs=source_refs,
        )

        report_create.additional_properties = d
        return report_create

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
