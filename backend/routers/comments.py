"""
Commentaires — un fil par souvenir — et « nouveautés » (la pastille).

LA règle : un commentaire est du contenu, il suit le déblocage. On ne lit et on
n'écrit le fil QUE d'un souvenir ouvert pour soi (même garde que
GET /posts/{id}). L'auteur voit toujours son propre souvenir, il peut donc
répondre sous le sien ; l'autre, seulement une fois sa journée remplie.

Corps JSON uniquement, jamais de paramètres d'URL (ils finiraient dans les
journaux).
"""
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, Field

import db
from services import push, reveal

logger = logging.getLogger("beus.comments")
router = APIRouter(prefix="/api/beus")

MAX_COMMENT_LEN = 500
EXTRAIT_NOTIF = 80


def _post_ouvert(conn, post_id: int, viewer: str) -> dict:
    """Le souvenir, s'il existe et s'il est ouvert pour `viewer` — sinon 404/403.
    403 et non 404 : l'existence d'un souvenir verrouillé est visible par design."""
    row = conn.execute("SELECT * FROM posts WHERE id=? AND deleted_at IS NULL",
                        (post_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Souvenir introuvable")
    post = dict(row)
    if not reveal.is_unlocked(post["day"], post["author_id"], viewer,
                               db.jours_remplis(conn, viewer)):
        raise HTTPException(status_code=403, detail="Pas encore débloqué")
    return post


def _marque_lu(conn, user_id: str, post_id: int):
    conn.execute(
        "INSERT INTO lectures (user_id, post_id, dernier_lu) "
        "SELECT ?, ?, COALESCE(MAX(id), 0) FROM commentaires WHERE post_id=? "
        "ON CONFLICT(user_id, post_id) DO UPDATE SET dernier_lu=excluded.dernier_lu",
        (user_id, post_id, post_id))


def _forme(c: dict) -> dict:
    return {"id": c["id"], "author_id": c["author_id"], "body": c["body"],
            "created_at": c["created_at"]}


@router.get("/posts/{post_id}/comments")
async def fil(request: Request, post_id: int):
    """Le fil, du plus ancien au plus récent. Le lire le marque comme lu."""
    moi = request.state.user_id
    with db.connect() as conn:
        _post_ouvert(conn, post_id, moi)
        coms = db.rows(conn.execute(
            "SELECT * FROM commentaires WHERE post_id=? AND deleted_at IS NULL ORDER BY id",
            (post_id,)))
        _marque_lu(conn, moi, post_id)
        conn.commit()
    return {"comments": [_forme(c) for c in coms]}


class NouveauCommentaire(BaseModel):
    body: str = Field(..., min_length=1, max_length=MAX_COMMENT_LEN)


def _notifie(post: dict, auteur: str, destinataire: str, texte: str):
    """Tâche de fond. Si le souvenir est encore verrouillé pour le
    destinataire (l'auteur a répondu sous le sien), la notification reste
    neutre : ni le texte, ni rien du souvenir."""
    with db.connect() as conn:
        nom = conn.execute("SELECT display_name FROM users WHERE id=?",
                            (auteur,)).fetchone()
        ouvert = reveal.is_unlocked(post["day"], post["author_id"], destinataire,
                                     db.jours_remplis(conn, destinataire))
    nom = nom["display_name"] if nom else auteur
    url = f"/#/feed?p={post['id']}"
    if not ouvert:
        push.envoie(destinataire, nom, "a écrit sous un souvenir que tu n’as pas encore ouvert",
                    url=url, tag=f"com-{post['id']}")
        return
    extrait = texte if len(texte) <= EXTRAIT_NOTIF else texte[:EXTRAIT_NOTIF - 1] + "…"
    quoi = "a commenté ton souvenir" if post["author_id"] == destinataire \
        else "a répondu sous son souvenir"
    push.envoie(destinataire, nom, f"{quoi} : « {extrait} »", url=url,
                tag=f"com-{post['id']}")


@router.post("/posts/{post_id}/comments", status_code=201)
async def commente(request: Request, post_id: int, corps: NouveauCommentaire,
                   background: BackgroundTasks):
    moi = request.state.user_id
    texte = corps.body.strip()
    if not texte:
        raise HTTPException(status_code=422, detail="Commentaire vide")
    with db.connect() as conn:
        post = _post_ouvert(conn, post_id, moi)
        cur = conn.execute(
            "INSERT INTO commentaires (post_id, author_id, body) VALUES (?,?,?)",
            (post_id, moi, texte))
        c = dict(conn.execute("SELECT * FROM commentaires WHERE id=?",
                               (cur.lastrowid,)).fetchone())
        _marque_lu(conn, moi, post_id)     # on a lu ce qu'on vient d'écrire
        conn.commit()
        autre = db.autre_compte(conn, moi)
    if autre:
        background.add_task(_notifie, post, moi, autre, texte)
    return _forme(c)


@router.delete("/comments/{comment_id}")
async def supprime(request: Request, comment_id: int):
    """Son propre commentaire seulement — l'admin n'a pas de pouvoir ici."""
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM commentaires WHERE id=? AND deleted_at IS NULL",
                            (comment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Commentaire introuvable")
        if row["author_id"] != request.state.user_id:
            raise HTTPException(status_code=403, detail="Ce n'est pas ton commentaire")
        conn.execute("UPDATE commentaires SET body='', deleted_at=CURRENT_TIMESTAMP "
                     "WHERE id=?", (comment_id,))
        conn.commit()
    return {"status": "ok"}


# ── Nouveautés : la pastille ────────────────────────────────────────────────

@router.get("/nouveautes")
async def nouveautes(request: Request):
    """Ce qui est nouveau pour moi depuis ma dernière lecture.

    · commentaires de l'autre non lus — seulement sur des souvenirs OUVERTS
      pour moi (un fil fermé ne se compte pas : je ne pourrais pas le lire) ;
    · souvenirs de l'autre pas encore vus dans le journal — verrouillés
      compris : leur existence est visible par design, c'est l'invitation à
      raconter sa journée."""
    moi = request.state.user_id
    with db.connect() as conn:
        mes_jours = db.jours_remplis(conn, moi)
        lignes = db.rows(conn.execute(
            "SELECT c.post_id, p.day, p.author_id AS post_author, COUNT(*) AS n "
            "FROM commentaires c JOIN posts p ON p.id = c.post_id "
            "LEFT JOIN lectures l ON l.user_id = ? AND l.post_id = c.post_id "
            "WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL AND c.author_id <> ? "
            "AND c.id > COALESCE(l.dernier_lu, 0) GROUP BY c.post_id",
            (moi, moi)))
        vu = conn.execute("SELECT COALESCE(journal_vu_id, 0) AS v FROM users WHERE id=?",
                           (moi,)).fetchone()
        nouveaux = conn.execute(
            "SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL "
            "AND author_id <> ? AND id > ?", (moi, vu["v"] if vu else 0)).fetchone()["n"]
    par_post = {str(r["post_id"]): r["n"] for r in lignes
                if reveal.is_unlocked(r["day"], r["post_author"], moi, mes_jours)}
    return {"commentaires_non_lus": sum(par_post.values()), "par_post": par_post,
            "nouveaux_souvenirs": nouveaux}


@router.post("/nouveautes/journal-vu")
async def journal_vu(request: Request):
    """Le journal vient d'être affiché : tout souvenir de l'autre existant est vu."""
    moi = request.state.user_id
    with db.connect() as conn:
        conn.execute(
            "UPDATE users SET journal_vu_id = (SELECT COALESCE(MAX(id), 0) FROM posts "
            "WHERE author_id <> ?) WHERE id=?", (moi, moi))
        conn.commit()
    return {"status": "ok"}
