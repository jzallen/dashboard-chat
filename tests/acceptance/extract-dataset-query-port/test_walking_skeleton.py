"""pytest entry — registers walking-skeleton scenarios with pytest-bdd.

`scenarios(...)` attaches generated test items to the module where it is
called, so it must live in a test_*.py module that pytest discovers.
Step bindings live in steps/dataset_query_port_steps.py and are
pulled in via conftest.py's re-export.
"""
from pytest_bdd import scenarios

scenarios("walking-skeleton.feature")
