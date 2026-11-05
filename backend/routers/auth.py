"""
Connexion par PIN — identité RÉELLE par utilisateur (alex/sam).
Voir security.py pour la différence assumée avec le pattern `sfauth` partagé
du reste de la stack.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import db
from services import storage
import security

logger = logging.getLogger("beus.auth")
router = APIRouter(prefix="/api/beus/auth")


class LoginBody(BaseModel):
    # Borné : sans limite, un identifiant démesuré passerait jusqu'à la requête
    # SQL (paramétrée, donc pas d'injection, mais coût inutile) et gonflerait les
    # logs. Les seuls comptes réels sont « alex » et « sam ».
    user_id: str = Field(min_length=1, max_length=32)
    pin: str = Field(min_length=4, max_length=8)


def _avatar_url(user_id: str, avatar_path: str | None) -> str | None:
    return storage.avatar_url(user_id, avatar_path)


def _public_user(u: dict) -> dict:
    return {"id": u["id"], "display_name": u["display_name"],
            "avatar_url": _avatar_url(u["id"], u["avatar_path"])}


def _session_user(u: dict) -> dict:
    return {"user_id": u["id"], "display_name": u["display_name"],
            "is_admin": bool(u["is_admin"]),
            "avatar_url": _avatar_url(u["id"], u["avatar_path"])}


@router.get("/accounts")
async def accounts():
    """Public : les deux comptes pour l'écran de connexion — aucune donnée
    sensible (ni PIN, ni statut admin)."""
    with db.connect() as conn:
        users = db.rows(conn.execute("SELECT * FROM users ORDER BY id"))
    return {"accounts": [_public_user(u) for u in users]}


@router.post("/login")
async def login(body: LoginBody, response: Response):
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (body.user_id,)).fetchone()
        if not row:
            return JSONResponse(status_code=401, content={"detail": "Compte inconnu"})
        user = dict(row)

        if user["locked_until"]:
            locked_until = datetime.fromisoformat(user["locked_until"])
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            reste = (locked_until - datetime.now(timezone.utc)).total_seconds()
            if reste > 0:
                # Le délai restant, en minutes entières : « plus tard » laissait
                # deviner et retenter, ce qui ne fait que repousser l'échéance.
                minutes = max(1, -(-int(reste) // 60))
                return JSONResponse(status_code=429, content={
                    "detail": f"Trop d'essais. Réessaie dans {minutes} min"})

        if not security.verify_pin(user["pin_hash"], body.pin):
            attempts = user["failed_pin_attempts"] + 1
            locked_until = None
            if attempts >= security.MAX_FAILED_ATTEMPTS:
                locked_until = (datetime.now(timezone.utc)
                                 + timedelta(seconds=security.LOCKOUT_SECONDS)).isoformat()
                attempts = 0
            conn.execute("UPDATE users SET failed_pin_attempts=?, locked_until=? WHERE id=?",
                         (attempts, locked_until, user["id"]))
            conn.commit()
            return JSONResponse(status_code=401, content={"detail": "Code incorrect"})

        conn.execute("UPDATE users SET failed_pin_attempts=0, locked_until=NULL WHERE id=?",
                     (user["id"],))
        conn.commit()

    token = security.create_token(user["id"], bool(user["is_admin"]))
    response.set_cookie(security.COOKIE_NAME, token, max_age=security.TOKEN_EXPIRY,
                         httponly=True, secure=True, samesite="lax", path="/")
    return _session_user(user)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(security.COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me")
async def me(request: Request):
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?",
                            (request.state.user_id,)).fetchone()
    if not row:
        return JSONResponse(status_code=401, content={"detail": "Non authentifié"})
    return _session_user(dict(row))
