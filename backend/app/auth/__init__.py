from .context import clear_auth_user as clear_auth_user
from .context import get_auth_user as get_auth_user
from .context import set_auth_user as set_auth_user
from .exceptions import AuthenticationError as AuthenticationError
from .exceptions import AuthorizationError as AuthorizationError
from .types import AuthUser

# The canonical dev identity. Backend no longer mints tokens (auth-proxy is the
# single issuer, ADR-043 stage 3); this constant survives only as the dev-mode
# identity fixture — auth-proxy's dev built-in M2M client mirrors it
# (auth-proxy/lib/m2m.ts) and the dev seed path references its org_id.
DEV_USER = AuthUser(id="dev-user-001", email="dev@localhost", org_id="dev-org-001", name="Dev User")
