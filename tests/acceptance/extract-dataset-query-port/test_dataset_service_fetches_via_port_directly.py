"""pytest entry — milestone-2 (caller migration: legacy shim -> direct port)."""
from pytest_bdd import scenarios

scenarios("dataset-service-fetches-via-port-directly.feature")
