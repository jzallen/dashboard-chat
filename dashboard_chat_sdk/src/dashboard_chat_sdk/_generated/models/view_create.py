from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
    from ..models.view_create_columns_item import ViewCreateColumnsItem
    from ..models.view_create_filters_item import ViewCreateFiltersItem
    from ..models.view_create_grain_type_0 import ViewCreateGrainType0
    from ..models.view_create_joins_item import ViewCreateJoinsItem
    from ..models.view_create_source_refs_item import ViewCreateSourceRefsItem


T = TypeVar("T", bound="ViewCreate")


@_attrs_define
class ViewCreate:
    """Schema for creating a new view.

    Attributes:
        name (str):
        columns (list[ViewCreateColumnsItem] | Unset):
        description (None | str | Unset):
        filters (list[ViewCreateFiltersItem] | Unset):
        grain (None | Unset | ViewCreateGrainType0):
        joins (list[ViewCreateJoinsItem] | Unset):
        materialization (str | Unset):  Default: 'ephemeral'.
        source_refs (list[ViewCreateSourceRefsItem] | Unset):
        sql_definition (str | Unset):  Default: ''.
    """

    name: str
    columns: list[ViewCreateColumnsItem] | Unset = UNSET
    description: None | str | Unset = UNSET
    filters: list[ViewCreateFiltersItem] | Unset = UNSET
    grain: None | Unset | ViewCreateGrainType0 = UNSET
    joins: list[ViewCreateJoinsItem] | Unset = UNSET
    materialization: str | Unset = "ephemeral"
    source_refs: list[ViewCreateSourceRefsItem] | Unset = UNSET
    sql_definition: str | Unset = ""
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.view_create_columns_item import ViewCreateColumnsItem
        from ..models.view_create_filters_item import ViewCreateFiltersItem
        from ..models.view_create_grain_type_0 import ViewCreateGrainType0
        from ..models.view_create_joins_item import ViewCreateJoinsItem
        from ..models.view_create_source_refs_item import ViewCreateSourceRefsItem

        name = self.name

        columns: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.columns, Unset):
            columns = []
            for columns_item_data in self.columns:
                columns_item = columns_item_data.to_dict()
                columns.append(columns_item)

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        filters: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = []
            for filters_item_data in self.filters:
                filters_item = filters_item_data.to_dict()
                filters.append(filters_item)

        grain: dict[str, Any] | None | Unset
        if isinstance(self.grain, Unset):
            grain = UNSET
        elif isinstance(self.grain, ViewCreateGrainType0):
            grain = self.grain.to_dict()
        else:
            grain = self.grain

        joins: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.joins, Unset):
            joins = []
            for joins_item_data in self.joins:
                joins_item = joins_item_data.to_dict()
                joins.append(joins_item)

        materialization = self.materialization

        source_refs: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.source_refs, Unset):
            source_refs = []
            for source_refs_item_data in self.source_refs:
                source_refs_item = source_refs_item_data.to_dict()
                source_refs.append(source_refs_item)

        sql_definition = self.sql_definition

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if columns is not UNSET:
            field_dict["columns"] = columns
        if description is not UNSET:
            field_dict["description"] = description
        if filters is not UNSET:
            field_dict["filters"] = filters
        if grain is not UNSET:
            field_dict["grain"] = grain
        if joins is not UNSET:
            field_dict["joins"] = joins
        if materialization is not UNSET:
            field_dict["materialization"] = materialization
        if source_refs is not UNSET:
            field_dict["source_refs"] = source_refs
        if sql_definition is not UNSET:
            field_dict["sql_definition"] = sql_definition

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.view_create_columns_item import ViewCreateColumnsItem
        from ..models.view_create_filters_item import ViewCreateFiltersItem
        from ..models.view_create_grain_type_0 import ViewCreateGrainType0
        from ..models.view_create_joins_item import ViewCreateJoinsItem
        from ..models.view_create_source_refs_item import ViewCreateSourceRefsItem

        d = dict(src_dict)
        name = d.pop("name")

        _columns = d.pop("columns", UNSET)
        columns: list[ViewCreateColumnsItem] | Unset = UNSET
        if _columns is not UNSET:
            columns = []
            for columns_item_data in _columns:
                columns_item = ViewCreateColumnsItem.from_dict(columns_item_data)

                columns.append(columns_item)

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        _filters = d.pop("filters", UNSET)
        filters: list[ViewCreateFiltersItem] | Unset = UNSET
        if _filters is not UNSET:
            filters = []
            for filters_item_data in _filters:
                filters_item = ViewCreateFiltersItem.from_dict(filters_item_data)

                filters.append(filters_item)

        def _parse_grain(data: object) -> None | Unset | ViewCreateGrainType0:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                grain_type_0 = ViewCreateGrainType0.from_dict(data)

                return grain_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | ViewCreateGrainType0, data)

        grain = _parse_grain(d.pop("grain", UNSET))

        _joins = d.pop("joins", UNSET)
        joins: list[ViewCreateJoinsItem] | Unset = UNSET
        if _joins is not UNSET:
            joins = []
            for joins_item_data in _joins:
                joins_item = ViewCreateJoinsItem.from_dict(joins_item_data)

                joins.append(joins_item)

        materialization = d.pop("materialization", UNSET)

        _source_refs = d.pop("source_refs", UNSET)
        source_refs: list[ViewCreateSourceRefsItem] | Unset = UNSET
        if _source_refs is not UNSET:
            source_refs = []
            for source_refs_item_data in _source_refs:
                source_refs_item = ViewCreateSourceRefsItem.from_dict(source_refs_item_data)

                source_refs.append(source_refs_item)

        sql_definition = d.pop("sql_definition", UNSET)

        view_create = cls(
            name=name,
            columns=columns,
            description=description,
            filters=filters,
            grain=grain,
            joins=joins,
            materialization=materialization,
            source_refs=source_refs,
            sql_definition=sql_definition,
        )

        view_create.additional_properties = d
        return view_create

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
