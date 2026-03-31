## Why

The `@with_repositories` / `@handle_returns` decorator stack is ordered incorrectly: `@with_repositories` is the outer decorator and `@handle_returns` is the inner decorator. This means that when `db.commit()` fails inside `with_repositories`, the exception is raised **after** `handle_returns` has already returned its `Success`/`Failure` result. The raw exception escapes to the controller, which expects a monadic result — not an unhandled exception.

The core guarantee of the monad pattern is that callers always receive a `Success` or `Failure`, never an unhandled exception. The current decorator order breaks this guarantee for any commit or rollback failure.

### Current flow (broken)

```
Controller → with_repositories → handle_returns → use_case()
                                                      ↓
                                  handle_returns catches exception → Failure(e)
                                                      ↓
              with_repositories receives Failure, calls db.commit()
                                                      ↓
                              commit() fails → raw exception escapes to Controller ✗
```

### Desired flow (fixed)

```
Controller → handle_returns → with_repositories → use_case()
                                                      ↓
                              with_repositories calls db.commit()
                                                      ↓
                              commit() fails → exception raised
                                                      ↓
              handle_returns catches exception → Failure(e) → Controller ✓
```

## What Changes

- **Flip the decorator order** on every use-case function: `@handle_returns` becomes the outer decorator and `@with_repositories` becomes the inner decorator, so all exceptions (including commit/rollback failures from `with_repositories`) are caught by `handle_returns` and wrapped in `Failure`.
- **Update CLAUDE.md** and the `backend-use-case` skill to document the corrected decorator stack order.
- **Update all existing use-case files** to apply the corrected decorator order (mechanical change, ~40 files).

## Capabilities

### New Capabilities

- `use-case-decorator-contract`: Specifies the correct decorator stack ordering and transactional guarantees for all backend use-case functions.

### Modified Capabilities

*(none — no existing spec covers this pattern)*

## Impact

**Backend code**
- All `backend/app/use_cases/**/*.py` — decorator order flipped (~40 files)

**Documentation / tooling**
- `CLAUDE.md` — corrected decorator stack example
- `.claude/skills/backend-use-case.md` — corrected pattern description

**Tests** — no expected changes; the observable contract (callers always receive `Success`/`Failure`) is preserved and strengthened.

**APIs / external systems** — none affected; this is a purely internal infrastructure change.
