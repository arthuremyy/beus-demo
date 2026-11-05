"""Abonnement d'un appareil aux notifications (services/push.py)."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import db
from config import settings
from services import push

router = APIRouter(prefix="/api/beus/push")


@router.get("/cle")
async def cle():
    """La clé publique VAPID, dont le navigateur a besoin pour s'abonner.
    `actif: false` = serveur sans clés : le front n'affiche pas le bouton."""
    return {"actif": push.actif(), "cle": settings.vapid_public if push.actif() else None}


class Cles(BaseModel):
    p256dh: str = Field(..., min_length=1, max_length=256)
    auth: str = Field(..., min_length=1, max_length=64)


class Abonnement(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=1024)
    keys: Cles


class Desabonnement(BaseModel):
    endpoint: str = Field(..., min_length=10, max_length=1024)


@router.post("/abonnement")
async def abonne(request: Request, a: Abonnement):
    # Un navigateur ne s'abonne qu'auprès d'un service de push réel : https seulement.
    if not a.endpoint.startswith("https://"):
        raise HTTPException(status_code=422, detail="Endpoint invalide")
    with db.connect() as conn:
        # ON CONFLICT : le même téléphone peut passer d'un compte à l'autre —
        # l'abonnement suit le compte connecté, il ne notifie pas les deux.
        conn.execute(
            "INSERT INTO push_abonnements (endpoint, user_id, p256dh, auth) VALUES (?,?,?,?) "
            "ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, "
            "p256dh=excluded.p256dh, auth=excluded.auth",
            (a.endpoint, request.state.user_id, a.keys.p256dh, a.keys.auth))
        conn.commit()
    return {"status": "ok"}


@router.post("/desabonnement")
async def desabonne(request: Request, d: Desabonnement):
    with db.connect() as conn:
        conn.execute("DELETE FROM push_abonnements WHERE endpoint=? AND user_id=?",
                     (d.endpoint, request.state.user_id))
        conn.commit()
    return {"status": "ok"}


@router.get("/etat")
async def etat(request: Request):
    with db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM push_abonnements WHERE user_id=?",
                          (request.state.user_id,)).fetchone()["n"]
    return {"actif": push.actif(), "appareils": n}
