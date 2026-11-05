"""
Profil : avatar, nom affiché, présentation, compteurs et médailles.

Les avatars ne font PAS partie de la mécanique de déblocage : ils sont toujours
visibles, et /users/{id}/avatar est même servi sans session (voir PUBLIC_PATHS
dans app.py) — l'écran de connexion affiche les deux visages avant qu'on ait
saisi le moindre code.

Rien ici ne doit livrer le contenu d'un souvenir : les compteurs sont des
nombres, pas des photos.
"""
import logging

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import db
from services import jour, medals, serie, storage

logger = logging.getLogger("beus.users")
router = APIRouter(prefix="/api/beus/users")

MAX_BIO_LEN = 180
MAX_NOM_LEN = 24


@router.post("/me/avatar")
async def upload_avatar(request: Request, avatar: UploadFile = File(...)):
    raw = await avatar.read()
    try:
        rel = storage.save_avatar(request.state.user_id, raw)
    except storage.InvalidPhoto as e:
        raise HTTPException(status_code=415, detail=str(e))
    with db.connect() as conn:
        conn.execute("UPDATE users SET avatar_path=? WHERE id=?",
                     (rel, request.state.user_id))
        conn.commit()
    return {"status": "ok", "avatar_url": storage.avatar_url(request.state.user_id, rel)}


@router.delete("/me/avatar")
async def supprime_avatar(request: Request):
    """Retire sa photo de profil : la colonne d'abord, le fichier ensuite —
    un fichier orphelin ne gêne personne, une colonne vers un fichier absent
    renverrait des 404 à l'écran de connexion."""
    with db.connect() as conn:
        row = conn.execute("SELECT avatar_path FROM users WHERE id=?",
                           (request.state.user_id,)).fetchone()
        conn.execute("UPDATE users SET avatar_path=NULL WHERE id=?", (request.state.user_id,))
        conn.commit()
    storage.delete_avatar(row["avatar_path"] if row else None)
    return {"status": "ok", "avatar_url": None}


@router.get("/{user_id}/avatar")
async def get_avatar(user_id: str):
    with db.connect() as conn:
        row = conn.execute("SELECT avatar_path FROM users WHERE id=?", (user_id,)).fetchone()
    if not row or not row["avatar_path"]:
        raise HTTPException(status_code=404, detail="Pas d'avatar")
    path = storage.resolve_photo_path(row["avatar_path"])
    if not path:
        raise HTTPException(status_code=404, detail="Pas d'avatar")
    return FileResponse(path, media_type="image/jpeg",
                         headers={"Cache-Control": "private, max-age=3600"})


def _profil(conn, user_id: str) -> dict:
    row = conn.execute(
        "SELECT id, display_name, bio, avatar_path, created_at FROM users WHERE id=?",
        (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    u = dict(row)

    # Les compteurs sont DÉRIVÉS, comme le reste : rien à resynchroniser.
    jours = db.jours_remplis(conn, user_id)
    etat = medals.agrege(conn, user_id)
    return {
        "id": u["id"],
        "display_name": u["display_name"],
        "bio": u["bio"],
        "avatar_url": storage.avatar_url(u["id"], u["avatar_path"]),
        "membre_depuis": u["created_at"],
        "compteurs": {
            "souvenirs": len(jours),
            "villes": len(etat["villes"]),
            "pays": len(etat["pays"]),
            "jours_a_deux": len(etat["jours_communs"]),
            "cote_a_cote": len(etat["cote_a_cote"]),
            "serie": serie.serie(etat["jours_communs"], jour.aujourdhui()),
        },
        "medailles": medals.tableau(conn, user_id),
    }


@router.get("/me")
async def mon_profil(request: Request):
    """Recalcule les médailles au passage : deux comptes, le coût est nul, et
    ça rattrape une attribution manquée (tâche de fond interrompue par un
    redémarrage, par exemple)."""
    with db.connect() as conn:
        medals.attribue(conn, request.state.user_id)
        return _profil(conn, request.state.user_id)


@router.get("/{user_id}/profil")
async def profil_de(request: Request, user_id: str):
    with db.connect() as conn:
        return _profil(conn, user_id)


class MajProfil(BaseModel):
    """Corps JSON — jamais de paramètres d'URL pour des données de profil :
    nginx les écrirait dans ses journaux."""
    display_name: str | None = Field(None, max_length=MAX_NOM_LEN)
    bio: str | None = Field(None, max_length=MAX_BIO_LEN)


@router.patch("/me")
async def maj_profil(request: Request, corps: MajProfil):
    """Champs absents = inchangés. Chaîne vide = effacé (pour la bio)."""
    nom = corps.display_name.strip() if corps.display_name is not None else None
    bio = corps.bio.strip() if corps.bio is not None else None
    if corps.display_name is not None and not nom:
        raise HTTPException(status_code=422, detail="Le nom ne peut pas être vide")

    with db.connect() as conn:
        if nom is not None:
            conn.execute("UPDATE users SET display_name=? WHERE id=?",
                          (nom[:MAX_NOM_LEN], request.state.user_id))
        if bio is not None:
            conn.execute("UPDATE users SET bio=? WHERE id=?",
                          (bio[:MAX_BIO_LEN] or None, request.state.user_id))
        conn.commit()
        return _profil(conn, request.state.user_id)


# ── Médailles à fêter ───────────────────────────────────────────────────────

@router.get("/me/medailles/nouvelles")
async def medailles_nouvelles(request: Request):
    """Mes médailles obtenues mais pas encore fêtées à l'écran."""
    moi = request.state.user_id
    with db.connect() as conn:
        medals.attribue(conn, moi)     # rattrape une attribution manquée
        codes = [r["code"] for r in conn.execute(
            "SELECT code FROM medailles WHERE user_id=? AND COALESCE(fetee,0)=0 "
            "ORDER BY obtained_at, code", (moi,))]
    out = []
    for code in codes:
        m = medals.PAR_CODE.get(code)
        if m:
            out.append({"code": m.code, "titre": m.titre, "description": m.description,
                        "famille": m.famille, "obtenue": True})
    return {"medailles": out}


class Fetees(BaseModel):
    codes: list[str] = Field(..., max_length=50)


@router.post("/me/medailles/fetees")
async def medailles_fetees(request: Request, corps: Fetees):
    with db.connect() as conn:
        conn.executemany("UPDATE medailles SET fetee=1 WHERE user_id=? AND code=?",
                         [(request.state.user_id, c) for c in corps.codes])
        conn.commit()
    return {"status": "ok"}
