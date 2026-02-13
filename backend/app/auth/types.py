from dataclasses import dataclass


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str
    org_id: str | None = None
    name: str | None = None
