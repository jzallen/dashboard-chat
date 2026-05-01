from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
    from ..models.view_update_columns_type_0_item import ViewUpdateColumnsType0Item
    from ..models.view_update_filters_type_0_item import ViewUpdateFiltersType0Item
    from ..models.view_update_grain_type_0 import ViewUpdateGrainType0
    from ..models.view_update_joins_type_0_item import ViewUpdateJoinsType0Item
    from ..models.view_update_source_refs_type_0_item import ViewUpdateSourceRefsType0Item


T = TypeVar("T", bound="ViewUpdate")


@_attrs_define
class ViewUpdate:
    """Schema for updating a view.

    Attributes:
        columns (list[ViewUpdateColumnsType0Item] | None | Unset):
        description (None | str | Unset):
        filters (list[ViewUpdateFiltersType0Item] | None | Unset):
        grain (None | Unset | ViewUpdateGrainType0):
        joins (list[ViewUpdateJoinsType0Item] | None | Unset):
        materialization (None | str | Unset):
        name (None | str | Unset):
        source_refs (list[ViewUpdateSourceRefsType0Item] | None | Unset):
        sql_definition (None | str | Unset):
    """

    columns: list[ViewUpdateColumnsType0Item] | None | Unset = UNSET
    description: None | str | Unset = UNSET
    filters: list[ViewUpdateFiltersType0Item] | None | Unset = UNSET
    grain: None | Unset | ViewUpdateGrainType0 = UNSET
    joins: list[ViewUpdateJoinsType0Item] | None | Unset = UNSET
    materialization: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    source_refs: list[ViewUpdateSourceRefsType0Item] | None | Unset = UNSET
    sql_definition: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.view_update_columns_type_0_item import ViewUpdateColumnsType0Item
        from ..models.view_update_filters_type_0_item import ViewUpdateFiltersType0Item
        from ..models.view_update_grain_type_0 import ViewUpdateGrainType0
        from ..models.view_update_joins_type_0_item import ViewUpdateJoinsType0Item
        from ..models.view_update_source_refs_type_0_item import ViewUpdateSourceRefsType0Item

        columns: list[dict[str, Any]] | None | Unset
        if isinstance(self.columns, Unset):
            columns = UNSET
        elif isinstance(self.columns, list):
            columns = []
            for columns_type_0_item_data in self.columns:
                columns_type_0_item = columns_type_0_item_data.to_dict()
                columns.append(columns_type_0_item)

        else:
            columns = self.columns

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        filters: list[dict[str, Any]] | None | Unset
        if isinstance(self.filters, Unset):
            filters = UNSET
        elif isinstance(self.filters, list):
            filters = []
            for filters_type_0_item_data in self.filters:
                filters_type_0_item = filters_type_0_item_data.to_dict()
                filters.append(filters_type_0_item)

        else:
            filters = self.filters

        grain: dict[str, Any] | None | Unset
        if isinstance(self.grain, Unset):
            grain = UNSET
        elif isinstance(self.grain, ViewUpdateGrainType0):
            grain = self.grain.to_dict()
        else:
            grain = self.grain

        joins: list[dict[str, Any]] | None | Unset
        if isinstance(self.joins, Unset):
            joins = UNSET
        elif isinstance(self.joins, list):
            joins = []
            for joins_type_0_item_data in self.joins:
                joins_type_0_item = joins_type_0_item_data.to_dict()
                joins.append(joins_type_0_item)

        else:
            joins = self.joins

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
        if name is not UNSET:
            field_dict["name"] = name
        if source_refs is not UNSET:
            field_dict["source_refs"] = source_refs
        if sql_definition is not UNSET:
            field_dict["sql_definition"] = sql_definition

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.view_update_columns_type_0_item import ViewUpdateColumnsType0Item
        from ..models.view_update_filters_type_0_item import ViewUpdateFiltersType0Item
        from ..models.view_update_grain_type_0 import ViewUpdateGrainType0
        from ..models.view_update_joins_type_0_item import ViewUpdateJoinsType0Item
        from ..models.view_update_source_refs_type_0_item import ViewUpdateSourceRefsType0Item

        d = dict(src_dict)

        def _parse_columns(data: object) -> list[ViewUpdateColumnsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                columns_type_0 = []
                _columns_type_0 = data
                for columns_type_0_item_data in _columns_type_0:
                    columns_type_0_item = ViewUpdateColumnsType0Item.from_dict(
                        columns_type_0_item_data
                    )

                    columns_type_0.append(columns_type_0_item)

                return columns_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[ViewUpdateColumnsType0Item] | None | Unset, data)

        columns = _parse_columns(d.pop("columns", UNSET))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_filters(data: object) -> list[ViewUpdateFiltersType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                filters_type_0 = []
                _filters_type_0 = data
                for filters_type_0_item_data in _filters_type_0:
                    filters_type_0_item = ViewUpdateFiltersType0Item.from_dict(
                        filters_type_0_item_data
                    )

                    filters_type_0.append(filters_type_0_item)

                return filters_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[ViewUpdateFiltersType0Item] | None | Unset, data)

        filters = _parse_filters(d.pop("filters", UNSET))

        def _parse_grain(data: object) -> None | Unset | ViewUpdateGrainType0:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                grain_type_0 = ViewUpdateGrainType0.from_dict(data)

                return grain_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | ViewUpdateGrainType0, data)

        grain = _parse_grain(d.pop("grain", UNSET))

        def _parse_joins(data: object) -> list[ViewUpdateJoinsType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                joins_type_0 = []
                _joins_type_0 = data
                for joins_type_0_item_data in _joins_type_0:
                    joins_type_0_item = ViewUpdateJoinsType0Item.from_dict(joins_type_0_item_data)

                    joins_type_0.append(joins_type_0_item)

                return joins_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[ViewUpdateJoinsType0Item] | None | Unset, data)

        joins = _parse_joins(d.pop("joins", UNSET))

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

        def _parse_source_refs(data: object) -> list[ViewUpdateSourceRefsType0Item] | None | Unset:
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
                    source_refs_type_0_item = ViewUpdateSourceRefsType0Item.from_dict(
                        source_refs_type_0_item_data
                    )

                    source_refs_type_0.append(source_refs_type_0_item)

                return source_refs_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[ViewUpdateSourceRefsType0Item] | None | Unset, data)

        source_refs = _parse_source_refs(d.pop("source_refs", UNSET))

        def _parse_sql_definition(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sql_definition = _parse_sql_definition(d.pop("sql_definition", UNSET))

        view_update = cls(
            columns=columns,
            description=description,
            filters=filters,
            grain=grain,
            joins=joins,
            materialization=materialization,
            name=name,
            source_refs=source_refs,
            sql_definition=sql_definition,
        )

        view_update.additional_properties = d
        return view_update

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
