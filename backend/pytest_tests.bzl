"""Macro to generate one py_test per test file + a test_suite grouping them."""

load("@rules_python//python:py_test.bzl", _py_test = "py_test")

def pytest_tests(name, srcs, deps, conftest = [], data = [], size = "medium", tags = [], compose_srcs = []):
    """Generate individual py_test targets for each test file and a test_suite.

    Args:
        name: Name for the test_suite grouping all generated tests.
        srcs: List of test source files (e.g. glob(["tests/utils/test_*.py"])).
        deps: Dependencies for each test target.
        conftest: Extra conftest.py files to include as srcs (beyond root conftest).
        data: Additional data files (pyproject.toml is always included).
        size: Bazel test size (default "medium").
        tags: Bazel tags to apply to all targets.
        compose_srcs: Subset of srcs that require `docker compose up -d` services
            (Redis, auth-proxy, stream.io, etc.). These targets get an additional
            `requires-compose` tag so CI can skip them via
            `--test_tag_filters=-requires-compose`.
    """
    tests = []
    for src in srcs:
        test_name = name + "_" + src.replace("/", "_").replace(".py", "")
        src_tags = tags + ["requires-compose"] if src in compose_srcs else tags
        _py_test(
            name = test_name,
            srcs = [src] + conftest,
            main = src,
            imports = ["."],
            data = ["pyproject.toml"] + data,
            args = [
                "backend/" + src,
                "-o", "addopts=",
                "-p", "no:xdist",
                "-p", "no:cacheprovider",
                "--import-mode=importlib",
                "--no-header",
                "-q",
            ],
            deps = deps,
            size = size,
            tags = src_tags,
        )
        tests.append(":" + test_name)
    native.test_suite(name = name, tests = tests, tags = tags)
