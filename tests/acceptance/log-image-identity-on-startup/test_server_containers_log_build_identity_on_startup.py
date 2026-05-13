"""pytest entry — registers server-containers-log-build-identity-on-startup scenarios with pytest-bdd.

Each scenario in server-containers-log-build-identity-on-startup.feature is enabled by removing
its @pending tag during DELIVER. `scenarios(...)` discovers the file and
registers every non-@pending scenario as a generated test item.

Step bindings live in steps/identity_steps.py and are pulled in via
conftest.py's re-export.
"""
from pytest_bdd import scenarios

scenarios("server-containers-log-build-identity-on-startup.feature")
