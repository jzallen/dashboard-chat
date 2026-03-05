# Capability: Organization Error Handling

**Status**: MODIFIED
**Domain**: organization

## Overview

Add error boundaries for WorkOS HTTP calls and co-locate organization exceptions.

## Behaviors

### WorkOS Error Handling

- `_create_workos_org` wraps `httpx` calls in try/except for `httpx.HTTPStatusError` and `httpx.RequestError`
- On failure, raises `ExternalServiceError` (a new `DomainException` subclass) with context about which WorkOS API call failed
- The WorkOS API base URL moves from a hardcoded string to `settings.workos_api_url` in `config.py`

### Exception Co-location

- New `ExternalServiceError` exception is defined in `organization/exceptions.py`
- No existing exceptions need to move (organization domain currently has no domain-specific exceptions)

## Constraints

- The error boundary must not swallow errors silently — `ExternalServiceError` must carry the original error message for debugging
- The WorkOS code path should have at least basic test coverage via mocked httpx responses
