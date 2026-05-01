from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
    from ..models.report_update_columns_metadata_type_0_item import (
        ReportUpdateColumnsMetadataType0Item,
    )
    from ..models.report_update_source_refs_type_0_item import ReportUpdateSourceRefsType0Item


T = TypeVar("T", bound="ReportUpdate")


@_attrs_define
class ReportUpdate:
    """Schema for updating a report.

    Attributes:
        columns_metadata (list[ReportUpdateColumnsMetadataType0Item] | None | Unset):
        description (None | str | Unset):
        domain (None | str | Unset):
        materialization (None | str | Unset):
        name (None | str | Unset):
        source_refs (list[ReportUpdateSourceRefsType0Item] | None | Unset):
        sql_definition (None | str | Unset):
    """

    columns_metadata: list[ReportUpdateColumnsMetadataType0Item] | None | Unset = UNSET
    description: None | str | Unset = UNSET
    domain: None | str | Unset = UNSET
    materialization: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    source_refs: list[ReportUpdateSourceRefsType0Item] | None | Unset = UNSET
    sql_definition: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.report_update_columns_metadata_type_0_item import (
            ReportUpdateColumnsMetadataType0Item,
        )
        from ..models.report_update_source_refs_type_0_item import ReportUpdateSourceRefsType0Item

        columns_metadata: list[dict[str, Any]] | None | Unset
        if isinstance(self.columns_metadata, Unset):
            columns_metadata = UNSET
        elif isinstance(self.columns_metadata, list):
            columns_metadata = []
            for columns_metadata_type_0_item_data in self.columns_metadata:
                columns_metadata_type_0_item = columns_metadata_type_0_item_data.to_dict()
                columns_metadata.append(columns_metadata_type_0_item)

        else:
            columns_metadata = self.columns_metadata

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        domain: None | str | Unset
        if isinstance(self.domain, Unset):
            domain = UNSET
        else:
            domain = self.domain

        materialization: None | str | Unset
        if isinstance(self.materialization, Unset):
            materialization = UNSET
        else:
            materialization = self.materialization

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        source_refs: list[dict[str, Any]] | None | Unset
        if isinstance(self.source_refs, Unset):
            source_refs = UNSET
        elif isinstance(self.source_refs, list):
            source_refs = []
            for source_refs_type_0_item_data in self.source_refs:
                source_refs_type_0_item = source_refs_type_0_item_data.to_dict()
                source_refs.append(source_refs_type_0_item)

        else:
            source_refs = self.source_refs

        sql_definition: None | str | Unset
        if isinstance(self.sql_definition, Unset):
            sql_definition = UNSET
        else:
            sql_definition = self.sql_definition

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if columns_metadata is not UNSET:
            field_dict["columns_metadata"] = columns_metadata
        if description is not UNSET:
            field_dict["description"] = description
        if domain is not UNSET:
            field_dict["domain"] = domain
        if materialization is not UNSET:
            field_dict["materialization"] = materialization
        if name is not UNSET:
            field_dict["name"] = name
        if source_refs is not UNSET:
            field_dict["source_refs"] = source_refs
        if sql_definition is not UNSET:
            field_dict["sql_definition"] = sql_definition

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.report_update_columns_metadata_type_0_item import (
            ReportUpdateColumnsMetadataType0Item,
        )
        from ..models.report_update_source_refs_type_0_item import ReportUpdateSourceRefsType0Item

        d = dict(src_dict)

        def _parse_columns_metadata(
            data: object,
        ) -> list[ReportUpdateColumnsMetadataType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                columns_metadata_type_0 = []
                _columns_metadata_type_0 = data
                for columns_metadata_type_0_item_data in _columns_metadata_type_0:
                    columns_metadata_type_0_item = ReportUpdateColumnsMetadataType0Item.from_dict(
                        columns_metadata_type_0_item_data
                    )

                    columns_metadata_type_0.append(columns_metadata_type_0_item)

                return columns_metadata_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[ReportUpdateColumnsMetadataType0Item] | None | Unset, data)

        columns_metadata = _parse_columns_metadata(d.pop("columns_metadata", UNSET))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_domain(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        domain = _parse_domain(d.pop("domain", UNSET))

        def _parse_materialization(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        materialization = _parse_materialization(d.pop("materialization", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_source_refs(
            data: object,
        ) -> list[ReportUpdateSourceRefsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                source_refs_type_0 = []
                _source_refs_type_0 = data
                for source_refs_type_0_item_data in _source_refs_type_0:
                    source_refs_type_0_item = ReportUpdateSourceRefsType0Item.from_dict(
                        source_refs_type_0_item_data
                    )

                    source_refs_type_0.append(source_refs_type_0_item)

                return source_refs_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[ReportUpdateSourceRefsType0Item] | None | Unset, data)

        source_refs = _parse_source_refs(d.pop("source_refs", UNSET))

        def _parse_sql_definition(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sql_definition = _parse_sql_definition(d.pop("sql_definition", UNSET))

        report_update = cls(
            columns_metadata=columns_metadata,
            description=description,
            domain=domain,
            materialization=materialization,
            name=name,
            source_refs=source_refs,
            sql_definition=sql_definition,
        )

        report_update.additional_properties = d
        return report_update

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
