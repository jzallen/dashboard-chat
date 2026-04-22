## Purpose

Defines the root Bazel workspace via `MODULE.bazel` (bzlmod), registering the Python 3.11 and Node.js 20 toolchains and the rulesets every service build depends on. It is the foundational layer every Bazel target in the repo sits on top of.

## Capability: bazel-workspace

Root Bazel workspace configuration using bzlmod (MODULE.bazel) with toolchain registration for Python 3.11 and Node.js 20.

### Behavior

- `MODULE.bazel` declares dependencies: `rules_python`, `rules_uv`, `rules_js`, `rules_ts`, `rules_oci`, `aspect_bazel_lib`
- Python toolchain registered via `rules_uv` reading `backend/uv.lock` for hermetic pip resolution
- Node.js toolchain registered via `rules_js` with npm dependencies from root `package-lock.json`
- `.bazelrc` configures local disk cache, sandbox defaults, test output formatting
- `.bazelversion` pins Bazel version for bazelisk
- Root `BUILD.bazel` defines top-level aliases (`//:build-all`, `//:test-all`)
- `.bazelignore` excludes `node_modules/`, `.venv/`, `backend/data/`, `.git/`

### Constraints

- All rulesets pinned to specific versions in MODULE.bazel
- No WORKSPACE file (bzlmod only)
- Local disk cache only (no remote cache configuration)
- Must work on Linux (CI) and macOS (dev) — platform-specific configs in .bazelrc
