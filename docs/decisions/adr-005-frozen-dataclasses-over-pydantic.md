# ADR-005: Frozen Dataclasses over Pydantic for Domain Models

## Status

Accepted

## Context and Problem Statement

Domain models need to represent business entities with invariants and behavior. The modeling approach must enforce immutability, support business logic methods, and minimize memory overhead while coexisting with Pydantic at the HTTP boundary.

## Decision Drivers

- Immutability enforcement at the language level to prevent accidental state mutation
- Support for business logic methods on domain models (e.g., `Dataset._build_table()`)
- Memory efficiency via `__slots__`
- Clear separation between validation-centric schemas (HTTP) and behavior-rich domain models

## Considered Options

1. **Frozen dataclasses (`@dataclass(frozen=True, slots=True)`)** (selected)
2. **Pydantic `BaseModel`**

### Option 1: Frozen Dataclasses

- Good, because `frozen=True` enforces immutability at the language level
- Good, because `slots=True` reduces memory overhead
- Good, because domain models can contain business logic that doesn't fit Pydantic's validation-centric design
- Bad, because it creates two model layers requiring conversion between them

### Option 2: Pydantic BaseModel

- Good, because it provides built-in validation and serialization
- Good, because it would unify the model layer (one model type everywhere)
- Bad, because its design is validation-centric, not behavior-centric
- Bad, because immutability is opt-in and less strictly enforced
- Bad, because it encourages mixing validation concerns with domain logic

## Decision Outcome

Chosen option: **Frozen dataclasses**, because they enforce immutability at the language level and support business logic methods, while Pydantic remains at the HTTP boundary where validation is the primary concern.

### Consequences

- **Good:** Domain models are immutable and memory-efficient, with clear separation between HTTP schemas and domain logic
- **Bad:** Two model layers -- Pydantic schemas (HTTP boundary) and frozen dataclasses (domain). Conversion happens in the controller via `from_record()` and `serialize()` methods

## Confirmation

Verify that domain model instances raise `FrozenInstanceError` on attribute assignment. Confirm that `from_record()` and `serialize()` correctly convert between Pydantic schemas and domain dataclasses.

## Related

- [ADR-006: Result Monad over Exceptions](adr-006-result-monad-over-exceptions.md) -- complementary domain model pattern for error handling
