"""pytest entry — registers walking-skeleton scenarios with pytest-bdd.

`scenarios(...)` attaches generated test items to the module where it is
called, so it must live in a `test_*.py` module that pytest discovers.
The actual @given/@when/@then bindings live in steps/identity_steps.py
and are pulled in via conftest.py's re-export.
"""
from pytest_bdd import scenarios

scenarios("walking-skeleton.feature")
