from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, BinaryIO, TextIO, TYPE_CHECKING, Generator

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

from ..types import UNSET, Unset
from typing import cast

if TYPE_CHECKING:
    from ..models.transform_create_condition_json_type_0 import TransformCreateConditionJsonType0
    from ..models.transform_create_expression_config_type_0 import (
        TransformCreateExpressionConfigType0,
    )


T = TypeVar("T", bound="TransformCreate")


@_attrs_define
class TransformCreate:
    """Schema for creating a Transform.

    dataset_id will come from the URL path, not the request body.

    Cross-field validation rules by transform_type:
    - filter: requires condition_json + condition_sql; rejects expression fields
    - clean/alias/map: requires target_column + expression_config; rejects condition fields

        Attributes:
            name (str):
            condition_json (None | TransformCreateConditionJsonType0 | Unset):
            condition_sql (None | str | Unset):
            description (None | str | Unset):
            expression_config (None | TransformCreateExpressionConfigType0 | Unset):
            expression_sql (None | str | Unset):
            nl_prompt (None | str | Unset):
            target_column (None | str | Unset):
            transform_type (str | Unset):  Default: 'filter'.
    """

    name: str
    condition_json: None | TransformCreateConditionJsonType0 | Unset = UNSET
    condition_sql: None | str | Unset = UNSET
    description: None | str | Unset = UNSET
    expression_config: None | TransformCreateExpressionConfigType0 | Unset = UNSET
    expression_sql: None | str | Unset = UNSET
    nl_prompt: None | str | Unset = UNSET
    target_column: None | str | Unset = UNSET
    transform_type: str | Unset = "filter"
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.transform_create_condition_json_type_0 import (
            TransformCreateConditionJsonType0,
        )
        from ..models.transform_create_expression_config_type_0 import (
            TransformCreateExpressionConfigType0,
        )

        name = self.name

        condition_json: dict[str, Any] | None | Unset
        if isinstance(self.condition_json, Unset):
            condition_json = UNSET
        elif isinstance(self.condition_json, TransformCreateConditionJsonType0):
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
        elif isinstance(self.expression_config, TransformCreateExpressionConfigType0):
            expression_config = self.expression_config.to_dict()
        else:
            expression_config = self.expression_config

        expression_sql: None | str | Unset
        if isinstance(self.expression_sql, Unset):
            expression_sql = UNSET
        else:
            expression_sql = self.expression_sql

        nl_prompt: None | str | Unset
        if isinstance(self.nl_prompt, Unset):
            nl_prompt = UNSET
        else:
            nl_prompt = self.nl_prompt

        target_column: None | str | Unset
        if isinstance(self.target_column, Unset):
            target_column = UNSET
        else:
            target_column = self.target_column

        transform_type = self.transform_type

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
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
        if nl_prompt is not UNSET:
            field_dict["nl_prompt"] = nl_prompt
        if target_column is not UNSET:
            field_dict["target_column"] = target_column
        if transform_type is not UNSET:
            field_dict["transform_type"] = transform_type

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.transform_create_condition_json_type_0 import (
            TransformCreateConditionJsonType0,
        )
        from ..models.transform_create_expression_config_type_0 import (
            TransformCreateExpressionConfigType0,
        )

        d = dict(src_dict)
        name = d.pop("name")

        def _parse_condition_json(data: object) -> None | TransformCreateConditionJsonType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                condition_json_type_0 = TransformCreateConditionJsonType0.from_dict(data)

                return condition_json_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TransformCreateConditionJsonType0 | Unset, data)

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
        ) -> None | TransformCreateExpressionConfigType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                expression_config_type_0 = TransformCreateExpressionConfigType0.from_dict(data)

                return expression_config_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | TransformCreateExpressionConfigType0 | Unset, data)

        expression_config = _parse_expression_config(d.pop("expression_config", UNSET))

        def _parse_expression_sql(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        expression_sql = _parse_expression_sql(d.pop("expression_sql", UNSET))

        def _parse_nl_prompt(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        nl_prompt = _parse_nl_prompt(d.pop("nl_prompt", UNSET))

        def _parse_target_column(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        target_column = _parse_target_column(d.pop("target_column", UNSET))

        transform_type = d.pop("transform_type", UNSET)

        transform_create = cls(
            name=name,
            condition_json=condition_json,
            condition_sql=condition_sql,
            description=description,
            expression_config=expression_config,
            expression_sql=expression_sql,
            nl_prompt=nl_prompt,
            target_column=target_column,
            transform_type=transform_type,
        )

        transform_create.additional_properties = d
        return transform_create

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
