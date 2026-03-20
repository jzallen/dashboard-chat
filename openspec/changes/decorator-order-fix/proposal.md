## Why

The `@with_repositories` / `@handle_returns` decorator stack is ordered incorrectly: `with_repositories` wraps the outside, so database commit failures escape the monad and surface as raw exceptions to callers. Equally, when the use-case body fails, `handle_returns` converts the exception to `Failure(e)` before `with_repositories` can see it, causing a spurious commit attempt on a failed transaction. Both defects break the core guarantee of the monad pattern — that callers always receive a `Success` or `Failure`, never an unhandled exception.

## What Changes

- **Flip the decorator order** on every use-case function: `@handle_returns` becomes the outer decorator and `@with_repositories` becomes the inner decorator, so all exceptions (including commit/rollback failures) are caught by `handle_returns` and wrapped in `Failure`.
- **Harden `with_repositories`** to wrap the entire function call *and* the commit in a single try/except, rolling back on any failure and re-raising so `handle_returns` can catch it. Currently, an exception raised by the inner function bypasses the rollback path entirely.
- **Update CLAUDE.md** and the `backend-use-case` skill to document the corrected decorator stack order.
- **Update all existing use-case files** to apply the corrected decorator order (mechanical change, ~40 files).

## Capabilities

### New Capabilities

- `use-case-decorator-contract`: Specifies the correct decorator stack ordering and transactional guarantees for all backend use-case functions.

### Modified Capabilities

*(none — no existing spec covers this pattern)*

## Impact

**Backend code**
- `backend/app/repositories/__init__.py` — `with_repositories` implementation hardened
- `backend/app/use_cases/__init__.py` — `handle_returns` unchanged; decorator order documented
- All `backend/app/use_cases/**/*.py` — decorator order updated (~40 files)

**Documentation / tooling**
- `CLAUDE.md` — corrected decorator stack example
- `.claude/skills/backend-use-case.md` — corrected pattern description

**Tests** — no expected changes; the observable contract (callers always receive `Success`/`Failure`) is preserved and strengthened.

**APIs / external systems** — none affected; this is a purely internal infrastructure change.
