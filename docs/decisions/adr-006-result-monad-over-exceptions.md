# ADR-006: Result Monad over Exceptions for Error Flow

## Status

Accepted

## Context and Problem Statement

Use cases need to communicate success and failure without relying on exception-based control flow. Error paths should be visible in the type signature so that callers are forced to handle both success and failure cases explicitly.

## Decision Drivers

- Explicit error paths visible in type signatures
- Pattern-matching on failure types for HTTP status code mapping
- Exceptions reserved for truly exceptional conditions (DB connection failure, S3 timeout)
- Safety net for unhandled exceptions via automatic wrapping

## Considered Options

1. **`returns` library's `Result[Success, Failure]` pattern via `@handle_returns`** (selected)
2. **Exception-based control flow**

### Option 1: Result Monad

- Good, because explicit result types make error paths visible in the type signature
- Good, because the controller can pattern-match on failure types to map domain errors to HTTP status codes
- Good, because `@handle_returns` auto-wraps raised exceptions into `Failure`, providing a safety net
- Bad, because every use case returns `Result`, and callers must handle both cases

### Option 2: Exceptions

- Good, because it is the standard Python error handling pattern
- Good, because it requires no additional library dependency
- Bad, because error paths are invisible in the type signature
- Bad, because it encourages catch-all handlers that mask domain-specific errors
- Bad, because control flow jumps are implicit and hard to trace

## Decision Outcome

Chosen option: **Result Monad via `@handle_returns`**, because it makes error paths explicit in type signatures and enables pattern-matching on failure types while providing a safety net for unhandled exceptions.

### Consequences

- **Good:** Every use case returns `Result`, making success and failure paths explicit. Controllers pattern-match on failure types for precise HTTP status code mapping
- **Bad:** Callers must always handle both `Success` and `Failure` cases. Testing uses `isinstance(result.failure(), SomeDomainException)` pattern

## Confirmation

Verify that all use cases return `Result` types and that controllers correctly map domain exception types to HTTP status codes. Confirm that `@handle_returns` catches unexpected exceptions and wraps them in `Failure`.

## Related

- [ADR-005: Frozen Dataclasses over Pydantic](adr-005-frozen-dataclasses-over-pydantic.md) -- complementary domain model pattern for entity modeling
