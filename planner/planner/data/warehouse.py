"""Abstract warehouse repository interface."""

from __future__ import annotations

from abc import ABC, abstractmethod

from planner.data.types import SemanticQuery, SemanticQueryResult


class WarehouseRepository(ABC):
    @abstractmethod
    async def query(self, query: SemanticQuery) -> SemanticQueryResult:
        ...

    @abstractmethod
    async def list_dimension_values(self, dimension_id: str, limit: int = 100) -> list[str]:
        ...
