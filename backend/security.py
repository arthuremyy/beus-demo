"""
PIN (bcrypt) + JWT — identité RÉELLE par utilisateur (alex/sam), contrairement
au pattern `sfauth` partagé du reste de la stack (un seul admin, `backend/auth.py`
à la racine). Secret dédié (BEUS_JWT_SECRET) et cookie au nom distinct
(`beusauth`) : BeUs est le seul service exposé publiquement avec de vraies
identités, on n'y mutualise pas le secret des services Tailscale-only.
"""
import time

import bcrypt
import jwt as _jwt

from config import settings

TOKEN_EXPIRY = 86400 * 7  # 7 jours
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_SECONDS = 15 * 60
COOKIE_NAME = "beusauth"


def verify_pin(pin_hash: str, pin: str) -> bool:
    if not pin_hash:
        return False
    return bcrypt.checkpw(pin.encode(), pin_hash.encode())


def create_token(user_id: str, is_admin: bool) -> str:
    payload = {
        "sub": user_id,
        "adm": bool(is_admin),
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_EXPIRY,
    }
    return _jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict | None:
    try:
        return _jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except _jwt.InvalidTokenError:
        return None
