from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
    from ..models.transform_update_item_condition_json_type_0 import (
        TransformUpdateItemConditionJsonType0,
    )
    from ..models.transform_update_item_expression_config_type_0 import (
        TransformUpdateItemExpressionConfigType0,
    )


T = TypeVar("T", bound="TransformUpdateItem")


@_attrs_define
class TransformUpdateItem:
    """A single item in a batch update.

    Attributes:
        id (str):
        condition_json (None | TransformUpdateItemConditionJsonType0 | Unset):
        condition_sql (None | str | Unset):
        description (None | str | Unset):
        expression_config (None | TransformUpdateItemExpressionConfigType0 | Unset):
        expression_sql (None | str | Unset):
        name (None | str | Unset):
        status (None | str | Unset):
    """

    id: str
    condition_json: None | TransformUpdateItemConditionJsonType0 | Unset = UNSET
    condition_sql: None | str | Unset = UNSET
    description: None | str | Unset = UNSET
    expression_config: None | TransformUpdateItemExpressionConfigType0 | Unset = UNSET
    expression_sql: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    status: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.transform_update_item_condition_json_type_0 import (
            TransformUpdateItemConditionJsonType0,
        )
        from ..models.transform_update_item_expression_config_type_0 import (
            TransformUpdateItemExpressionConfigType0,
        )

        id = self.id

        condition_json: dict[str, Any] | None | Unset
        if isinstance(self.condition_json, Unset):
            condition_json = UNSET
        elif isinstance(self.condition_json, TransformUpdateItemConditionJsonType0):
            condition_json = self.condition_json.to_dict()
        else:
            condition_json = self.condition_json

        condition_sql: None | str | Unset
        if isinstance(self.condition_sql, Unset):
            condition_sql = UNSET
        else:
            condition_sql = self.condition_sql

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        expression_config: dict[str, Any] | None | Unset
        if isinstance(self.expression_config, Unset):
            expression_config = UNSET
        elif isinstance(self.expression_config, TransformUpdateItemExpressionConfigType0):
            expression_config = self.expression_config.to_dict()
        else:
            expression_config = self.expression_config

        expression_sql: None | str | Unset
        if isinstance(self.expression_sql, Unset):
            expression_sql = UNSET
        else:
            expression_sql = self.expression_sql

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        status: None | str | Unset
        if isinstance(self.status, Unset):
            status = UNSET
        else:
            status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
            }
        )
        if condition_json is not UNSET:
            field_dict["condition_json"] = condition_json
        if condition_sql is not UNSET:
            field_dict["condition_sql"] = condition_sql
        if description is not UNSET:
            field_dict["description"] = description
        if expression_config is not UNSET:
            field_dict["expression_config"] = expression_config
        if expression_sql is not UNSET:
            field_dict["expression_sql"] = expression_sql
        if name is not UNSET:
            field_dict["name"] = name
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.transform_update_item_condition_json_type_0 import (
            TransformUpdateItemConditionJsonType0,
        )
        from ..models.transform_update_item_expression_config_type_0 import (
            TransformUpdateItemExpressionConfigType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        def _parse_condition_json(
            data: object,
        ) -> None | TransformUpdateItemConditionJsonType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                condition_json_type_0 = TransformUpdateItemConditionJsonType0.from_dict(data)

                return condition_json_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TransformUpdateItemConditionJsonType0 | Unset, data)

        condition_json = _parse_condition_json(d.pop("condition_json", UNSET))

        def _parse_condition_sql(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        condition_sql = _parse_condition_sql(d.pop("condition_sql", UNSET))

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_expression_config(
            data: object,
        ) -> None | TransformUpdateItemExpressionConfigType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                expression_config_type_0 = TransformUpdateItemExpressionConfigType0.from_dict(data)

                return expression_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TransformUpdateItemExpressionConfigType0 | Unset, data)

        expression_config = _parse_expression_config(d.pop("expression_config", UNSET))

        def _parse_expression_sql(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        expression_sql = _parse_expression_sql(d.pop("expression_sql", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        def _parse_status(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        status = _parse_status(d.pop("status", UNSET))

        transform_update_item = cls(
            id=id,
            condition_json=condition_json,
            condition_sql=condition_sql,
            description=description,
            expression_config=expression_config,
            expression_sql=expression_sql,
            name=name,
            status=status,
        )

        transform_update_item.additional_properties = d
        return transform_update_item

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
