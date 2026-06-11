"""Unit tests for the OrgCreate request schema (the inbound validation port).

ADR-050 §c: the retired machine-side ``isOrgNameValid`` guard relocates to the
backend ``OrgCreate`` Pydantic schema (the SSOT). A blank / whitespace-only name
is rejected (FastAPI maps the ValidationError to HTTP 422); a valid name is
stored stripped of surrounding whitespace.
"""

import pytest
from pydantic import ValidationError

from app.routers.organizations import OrgCreate


@pytest.mark.parametrize("blank_name", ["", "   ", "\t", "\n", "  \t \n "])
def test_blank_or_whitespace_name_is_rejected(blank_name: str):
    """A blank / whitespace-only org name fails schema validation."""
    with pytest.raises(ValidationError):
        OrgCreate(name=blank_name)


def test_surrounding_whitespace_is_stripped():
    """A valid name is stored with surrounding whitespace stripped."""
    assert OrgCreate(name="  Acme  ").name == "Acme"
