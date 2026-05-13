"""pytest entry — registers corrupt-version-json-degrades-gracefully scenarios.

The scenarios in corrupt-version-json-degrades-gracefully.feature exercise AC1.5:
when /etc/dashboard-chat/version.json is missing or unparseable, services
must still boot and emit a single canonical identity line with literal
"unknown" tokens. Step bindings live in steps/identity_steps.py.
"""
from pytest_bdd import scenarios

scenarios("corrupt-version-json-degrades-gracefully.feature")
