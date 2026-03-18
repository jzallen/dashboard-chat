"""RSA key pair for dev-mode JWT signing and verification.

Keys are generated once at module import and live for the process lifetime.
This replaces the hardcoded "dev-token-static" string with real RS256 JWTs
so that dev mode exercises the same verification code path as production.
"""

import jwt.algorithms
from cryptography.hazmat.primitives.asymmetric import rsa

_KID = "dev-key-1"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_key = _private_key.public_key()


def get_private_key() -> rsa.RSAPrivateKey:
    return _private_key


def get_public_key() -> rsa.RSAPublicKey:
    return _public_key


def get_jwks_dict() -> dict:
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(_public_key, as_dict=True)
    jwk["kid"] = _KID
    jwk["use"] = "sig"
    jwk["alg"] = "RS256"
    return {"keys": [jwk]}
