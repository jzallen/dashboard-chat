"""pytest entry — registers milestone-4 graceful-degradation scenarios.

The scenarios in milestone-4-graceful-degradation.feature exercise AC1.5:
when /etc/dashboard-chat/version.json is missing or unparseable, services
must still boot and emit a single canonical identity line with literal
"unknown" tokens. Step bindings live in steps/identity_steps.py.
"""
from pytest_bdd import scenarios

scenarios("milestone-4-graceful-degradation.feature")
