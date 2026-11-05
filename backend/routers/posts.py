"""
Posts BeUs — création (capture double photo + position), carte, flux, service
des photos, et les deux actions admin (suppression, purge).

Voir services/reveal.py pour la règle de déblocage et services/storage.py pour
la validation/le stockage des photos. L'admin ne contourne JAMAIS la règle de
déblocage en navigation normale (GET /posts/map, /posts/feed, /posts/{id},
/photos/...) — ses pouvoirs se limitent aux deux endpoints explicitement gatés
DELETE et /purge.
"""
import logging

from fastapi import (APIRouter, BackgroundTasks, File, Form, HTTPException, Request,
                      UploadFile)
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

import db
from services import geocode, jour, labels, medals, push, reveal, storage

logger = logging.getLogger("beus.posts")
router = APIRouter(prefix="/api/beus/posts")
photos_router = APIRouter(prefix="/api/beus/photos")
jours_router = APIRouter(prefix="/api/beus/jours")
echo_router = APIRouter(prefix="/api/beus/souvenirs")
lieu_router = APIRouter(prefix="/api/beus/lieu")

MAX_CAPTION_LEN = 280
VALID_FACING = {"user", "environment"}
# « blur » est servi SANS vérifier le déblocage : c'est l'aperçu assumé d'un
# souvenir verrouillé. Les deux autres exigent le déblocage.
SLOT_COLUMN = {"primary": "primary_photo_path", "secondary": "secondary_photo_path",
                "blur": "blur_photo_path"}
SLOT_LIBRE = {"blur"}


def _apres_publication(post_id: int, lat: float, lng: float, auteur: str,
                       jour_vise: str):
    """Tâche de fond : étiquetage du lieu, attribution des médailles pour les
    DEUX comptes (une médaille de couple se gagne à deux, alors qu'un seul des
    deux vient de publier), puis notification de l'autre."""
    labels.label_post(post_id, lat, lng)
    autre = nom = None
    deja_rempli = False
    try:
        with db.connect() as conn:
            medals.attribue_tous(conn)
            autre = db.autre_compte(conn, auteur)
            r = conn.execute("SELECT display_name FROM users WHERE id=?", (auteur,)).fetchone()
            nom = r["display_name"] if r else auteur
            deja_rempli = bool(autre) and db.jour_rempli(conn, autre, jour_vise)
    except Exception:
        logger.exception("attribution des médailles impossible (souvenir %s)", post_id)
    if not autre:
        return
    # JAMAIS la légende : tant que l'autre n'a pas rempli ce jour, le souvenir
    # est verrouillé pour lui. S'il l'a déjà rempli, il s'ouvre aussitôt.
    corps = ("a publié son souvenir, va voir"
             if deja_rempli else "a publié son souvenir. Publie le tien pour le voir")
    push.envoie(autre, nom, corps, url=f"/#/feed?p={post_id}", tag=f"post-{jour_vise}")


def _require_admin(request: Request):
    if not request.state.is_admin:
        raise HTTPException(status_code=403, detail="Réservé à l'admin")


def _shape_post(post: dict, unlocked: bool, n_comments: int = 0) -> dict:
    """Ce qui sort d'un souvenir selon qu'il est ouvert ou non.

    Un souvenir VERROUILLÉ n'est pas caché : on en montre le jour, l'auteur, le
    lieu et une vignette floutée — assez pour savoir qu'il s'est passé quelque
    chose, pas assez pour le voir. Ce qui ne sort JAMAIS avant déblocage : la
    légende et les deux photos pleines. Toute clé ajoutée ici sort AUSSI pour un
    souvenir verrouillé — vérifier avant d'en ajouter une.

    `comment_count` n'est posé QUE dans la branche ouverte : le fil suit le
    déblocage, même son existence."""
    base = {"id": post["id"], "author_id": post["author_id"], "seq": post["seq"],
            "day": post["day"], "is_catchup": bool(post["is_catchup"]),
            "lat": post["lat"], "lng": post["lng"], "unlocked": unlocked,
            "location_label": post["location_label"], "city": post["city"],
            "created_at": post["created_at"],
            # Aussi pour un souvenir OUVERT : le front l'affiche en attendant la
            # photo pleine (~1 Ko, servie sans contrôle de toute façon).
            "blur_photo_url": (f"/api/beus/photos/{post['id']}/blur"
                               if post["blur_photo_path"] else None)}
    if not unlocked:
        return base
    base.update({
        "caption": post["caption"],
        "primary_facing": post["primary_facing"], "captured_at": post["captured_at"],
        "primary_photo_url": f"/api/beus/photos/{post['id']}/primary",
        "secondary_photo_url": f"/api/beus/photos/{post['id']}/secondary",
        "comment_count": n_comments,
    })
    return base


def _tombstone(conn, post: dict, reason: str):
    """La vignette floutée part avec les photos : la laisser derrière
    laisserait un aperçu d'un souvenir supprimé.

    `day` est CONSERVÉ (l'index unique est partiel : le jour redevient libre) et
    `seq` aussi, pour ne renuméroter personne."""
    storage.delete_post_photos(post["primary_photo_path"], post["secondary_photo_path"],
                                post["blur_photo_path"])
    conn.execute(
        "UPDATE posts SET caption=NULL, lat=NULL, lng=NULL, location_label=NULL, "
        "city=NULL, country=NULL, captured_at=NULL, primary_photo_path=NULL, "
        "secondary_photo_path=NULL, blur_photo_path=NULL, "
        "deleted_at=CURRENT_TIMESTAMP, deleted_reason=? WHERE id=?",
        (reason, post["id"]))
    # Le fil part avec le souvenir : des commentaires orphelins n'auraient plus
    # de sens, et ils pourraient citer la légende effacée.
    conn.execute("UPDATE commentaires SET body='', deleted_at=CURRENT_TIMESTAMP "
                 "WHERE post_id=? AND deleted_at IS NULL", (post["id"],))


# ── Création ─────────────────────────────────────────────────────────────────

@router.post("")
async def create_post(request: Request, background: BackgroundTasks,
                       primary_photo: UploadFile = File(...),
                       secondary_photo: UploadFile = File(...),
                       primary_facing: str = Form(...),
                       lat: float = Form(...),
                       lng: float = Form(...),
                       caption: str | None = Form(None),
                       location_label: str | None = Form(None),
                       captured_at: str | None = Form(None),
                       day: str | None = Form(None)):
    """`day` absent = aujourd'hui. Renseigné, c'est un rattrapage : on comble un
    jour passé, dans la limite de la fenêtre (services/jour.py).

    La position reste celle de MAINTENANT, pas celle du jour comblé — on ne
    réécrit pas le GPS. C'est précisément pour ça que le souvenir est marqué
    `is_catchup` : le lieu dit où on est, pas où on était."""
    if primary_facing not in VALID_FACING:
        raise HTTPException(status_code=422, detail="Caméra inconnue")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=422, detail="Coordonnées invalides")
    caption = (caption or "").strip()[:MAX_CAPTION_LEN] or None
    try:
        jour_vise = jour.valide(day)
    except jour.JourInvalide as e:
        raise HTTPException(status_code=422, detail=str(e))

    try:
        primary_bytes = await storage.stage_upload(primary_photo)
        secondary_bytes = await storage.stage_upload(secondary_photo)
    except storage.InvalidPhoto as e:
        raise HTTPException(status_code=415, detail=str(e))

    tmp_dir = storage.new_tmp_dir()
    storage.write_staged(tmp_dir, primary_bytes, secondary_bytes)

    with db.connect() as conn:
        try:
            result = db.insert_post(
                conn, author_id=request.state.user_id, day=jour_vise,
                is_catchup=jour.est_rattrapage(jour_vise),
                caption=caption, lat=lat, lng=lng,
                location_label=location_label, primary_facing=primary_facing,
                captured_at=captured_at)
        except db.JourDejaRempli:
            storage.jette_staged(tmp_dir)
            raise HTTPException(status_code=409,
                                 detail="Ta journée est déjà racontée pour ce jour")
        try:
            primary_rel, secondary_rel, blur_rel = storage.commit_post_photos(
                tmp_dir, result["id"])
            db.set_post_photos(conn, result["id"], primary_rel, secondary_rel, blur_rel)
        except OSError:
            conn.execute("DELETE FROM posts WHERE id=?", (result["id"],))
            conn.commit()
            raise HTTPException(status_code=500, detail="Échec de l'enregistrement des photos")

    # Nom de lieu en tâche de fond : l'upload ne doit pas attendre le réseau.
    # Les médailles suivent le géocodage et NON l'inverse : « cinq villes » et
    # « même ville » se calculent sur posts.city, que label_post vient d'écrire.
    background.add_task(_apres_publication, result["id"], lat, lng,
                        request.state.user_id, jour_vise)
    return {"id": result["id"], "seq": result["seq"], "day": result["day"],
            "is_catchup": jour.est_rattrapage(jour_vise)}


# ── Lecture ──────────────────────────────────────────────────────────────────

@router.get("/map")
async def map_markers(request: Request):
    """Tous les marqueurs (verrouillés compris) — sans paramètres."""
    with db.connect() as conn:
        mes_jours = db.jours_remplis(conn, request.state.user_id)
        posts = db.rows(conn.execute(
            "SELECT * FROM posts WHERE deleted_at IS NULL ORDER BY created_at"))
        coms = db.comptes_commentaires(conn, [p["id"] for p in posts])
    out = []
    for p in posts:
        unlocked = reveal.is_unlocked(p["day"], p["author_id"], request.state.user_id, mes_jours)
        out.append(_shape_post(p, unlocked, coms.get(p["id"], 0)))
    return {"posts": out}


class FeedQuery(BaseModel):
    """Curseur en DEUX parties, et c'est nécessaire : le flux est classé par
    JOUR, pas par ordre d'arrivée. Un jour comblé après coup reçoit un `id`
    plus grand que des souvenirs de jours postérieurs — trier par `id` seul
    remontait le 19 au-dessus du 20."""
    before_day: str | None = None
    before_id: int | None = None
    limit: int = Field(20, ge=1, le=100)


@router.post("/feed")
async def feed(request: Request, q: FeedQuery):
    """Flux paginé, du plus récent au plus ancien, VERROUILLÉS COMPRIS.

    Le flux ne filtre plus : un souvenir qu'on n'a pas encore ouvert doit se
    voir (floutté, daté, situé), sinon rien n'indique qu'il y a quelque chose à
    ouvrir. C'est _shape_post qui décide de ce qui sort.

    La pagination lit exactement `limit` lignes et rend le curseur de la
    dernière RENDUE. L'ancienne version lisait `limit * 3` lignes, en rendait au
    plus `limit`, puis repartait de l'id de la dernière LUE : tout ce qui se
    trouvait entre la dernière rendue et la dernière lue était sauté.

    Le tri porte sur (jour, id) et le curseur aussi — une comparaison de
    n-uplets SQLite, qui reprend exactement à la ligne suivante même quand
    plusieurs souvenirs partagent un jour."""
    ordre = "ORDER BY COALESCE(day,'0000-00-00') DESC, id DESC"
    with db.connect() as conn:
        mes_jours = db.jours_remplis(conn, request.state.user_id)
        if q.before_day and q.before_id:
            cur = conn.execute(
                "SELECT * FROM posts WHERE deleted_at IS NULL "
                f"AND (COALESCE(day,'0000-00-00'), id) < (?, ?) {ordre} LIMIT ?",
                (q.before_day, q.before_id, q.limit))
        else:
            cur = conn.execute(
                f"SELECT * FROM posts WHERE deleted_at IS NULL {ordre} LIMIT ?",
                (q.limit,))
        posts = db.rows(cur)
        coms = db.comptes_commentaires(conn, [p["id"] for p in posts])

    out = [_shape_post(p, reveal.is_unlocked(p["day"], p["author_id"],
                                               request.state.user_id, mes_jours),
                       coms.get(p["id"], 0))
           for p in posts]
    encore = len(posts) == q.limit
    return {"posts": out,
            "next_before_day": posts[-1]["day"] if encore else None,
            "next_before_id": posts[-1]["id"] if encore else None}


@router.get("/{post_id}")
async def get_post(request: Request, post_id: int):
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id=? AND deleted_at IS NULL",
                            (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post introuvable")
        post = dict(row)
        mes_jours = db.jours_remplis(conn, request.state.user_id)
        coms = db.comptes_commentaires(conn, [post_id])
    unlocked = reveal.is_unlocked(post["day"], post["author_id"],
                                   request.state.user_id, mes_jours)
    if not unlocked:
        raise HTTPException(status_code=403, detail="Pas encore débloqué")
    return _shape_post(post, True, coms.get(post_id, 0))


class MajLegende(BaseModel):
    caption: str = Field("", max_length=MAX_CAPTION_LEN)


@router.patch("/{post_id}")
async def maj_legende(request: Request, post_id: int, corps: MajLegende):
    """L'auteur corrige sa légende. Rien d'autre ne se modifie : ni le jour,
    ni les photos, ni le lieu. (Supprimer reste réservé à l'admin.)"""
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id=? AND deleted_at IS NULL",
                            (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post introuvable")
        if row["author_id"] != request.state.user_id:
            raise HTTPException(status_code=403, detail="Ce n'est pas ton souvenir")
        legende = corps.caption.strip()[:MAX_CAPTION_LEN] or None
        conn.execute("UPDATE posts SET caption=? WHERE id=?", (legende, post_id))
        conn.commit()
        coms = db.comptes_commentaires(conn, [post_id])
        post = dict(conn.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone())
    return _shape_post(post, True, coms.get(post_id, 0))


# ── Écho : il y a un mois, il y a un an ─────────────────────────────────────

def _decale(ref: str, mois: int) -> str | None:
    """Le même quantième `mois` mois plus tôt ; None s'il n'existe pas
    (un 31 n'a pas d'écho dans un mois de 30 jours — on ne triche pas)."""
    from datetime import date
    d = date.fromisoformat(ref)
    total = d.year * 12 + (d.month - 1) - mois
    try:
        return date(total // 12, total % 12 + 1, d.day).isoformat()
    except ValueError:
        return None


@echo_router.get("/echo")
async def echo(request: Request):
    """Les souvenirs OUVERTS pour moi d'il y a un mois et d'il y a un an,
    jour pour jour. Un verrouillé n'en fait pas partie : une journée perdue le
    reste, même un an après."""
    moi = request.state.user_id
    ref = jour.aujourdhui()
    cibles = {k: _decale(ref, n) for k, n in (("mois", 1), ("an", 12))}
    out = []
    with db.connect() as conn:
        mes_jours = db.jours_remplis(conn, moi)
        for quand, day in cibles.items():
            if not day:
                continue
            posts = db.rows(conn.execute(
                "SELECT * FROM posts WHERE deleted_at IS NULL AND day=? ORDER BY id", (day,)))
            coms = db.comptes_commentaires(conn, [p["id"] for p in posts])
            for p in posts:
                if reveal.is_unlocked(p["day"], p["author_id"], moi, mes_jours):
                    out.append({"quand": quand, **_shape_post(p, True, coms.get(p["id"], 0))})
    return {"souvenirs": out}


# ── Photos ───────────────────────────────────────────────────────────────────

@photos_router.get("/{post_id}/{slot}")
async def get_photo(request: Request, post_id: int, slot: str):
    if slot not in SLOT_COLUMN:
        raise HTTPException(status_code=404, detail="Emplacement inconnu")
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id=? AND deleted_at IS NULL",
                            (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post introuvable")
        post = dict(row)
        mes_jours = db.jours_remplis(conn, request.state.user_id)
    unlocked = reveal.is_unlocked(post["day"], post["author_id"],
                                   request.state.user_id, mes_jours)
    if not unlocked and slot not in SLOT_LIBRE:
        # 403, pas 404 : l'existence du pin est déjà visible sur la carte par design.
        raise HTTPException(status_code=403, detail="Pas encore débloqué")
    rel = post[SLOT_COLUMN[slot]]
    path = storage.resolve_photo_path(rel) if rel else None
    if not path:
        raise HTTPException(status_code=404, detail="Photo introuvable")
    # « private » : cache navigateur autorisé, cache Cloudflare interdit — sans
    # quoi chaque défilement du flux re-télécharge toutes les photos.
    return FileResponse(path, media_type="image/jpeg",
                         headers={"Cache-Control": "private, max-age=3600"})


# ── Admin ────────────────────────────────────────────────────────────────────

@router.delete("/{post_id}")
async def delete_post(request: Request, post_id: int):
    _require_admin(request)
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM posts WHERE id=? AND deleted_at IS NULL",
                            (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post introuvable")
        _tombstone(conn, dict(row), "admin_delete")
        conn.commit()
    return {"status": "ok"}


class PurgeQuery(BaseModel):
    older_than_days: int = Field(..., ge=1)
    dry_run: bool = True


@router.post("/purge")
async def purge(request: Request, q: PurgeQuery):
    _require_admin(request)
    with db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM posts WHERE deleted_at IS NULL "
            "AND created_at < datetime('now', ?) ORDER BY created_at",
            (f"-{q.older_than_days} days",))
        candidates = db.rows(cur)
        if q.dry_run:
            return {"dry_run": True, "count": len(candidates),
                    "ids": [c["id"] for c in candidates]}
        for c in candidates:
            _tombstone(conn, c, "purge")
        conn.commit()
    return {"dry_run": False, "purged": len(candidates)}


# ── Les jours ────────────────────────────────────────────────────────────────

@jours_router.get("")
async def jours(request: Request):
    """L'état de la fenêtre : ce qui est fait, ce qui reste à combler.

    C'est la source unique de l'écran de capture (quel jour on vise) et de la
    frise du flux. Le front ne recalcule pas la fenêtre de son côté : le
    téléphone peut être à l'heure d'un autre fuseau, ou simplement à l'heure
    fausse — le jour se décide au serveur (services/jour.py)."""
    moi = request.state.user_id
    ref = jour.aujourdhui()
    with db.connect() as conn:
        autre_row = conn.execute("SELECT id FROM users WHERE id<>? LIMIT 1", (moi,)).fetchone()
        autre = autre_row["id"] if autre_row else None
        mes_jours = db.jours_remplis(conn, moi)
        ses_jours = db.jours_remplis(conn, autre) if autre else set()

    fenetre = jour.fenetre(ref)
    return {
        "aujourdhui": ref,
        "autre_id": autre,
        "jours": [{
            "day": d,
            "moi": d in mes_jours,
            "autre": d in ses_jours,
            # Un souvenir de l'autre existe ET je l'ai ouvert en remplissant ce jour.
            "debloque": (d in ses_jours) and (d in mes_jours),
            "a_combler": (d not in mes_jours) and d != ref,
        } for d in fenetre],
        "a_combler": [d for d in fenetre if d not in mes_jours and d != ref],
        "aujourdhui_rempli": ref in mes_jours,
    }


# ── Le lieu, avant publication ───────────────────────────────────────────────

@lieu_router.get("")
def lieu(lat: float, lng: float):
    """Le libellé lisible d'une position, pour l'écran de révision : sans lui,
    on y lisait des coordonnées brutes alors que partout ailleurs l'app écrit
    « Bastille, Paris ». Synchrone (exécuté hors de la boucle) : Nominatim est
    limité à 1 requête/s par services/geocode.py. Aucun stockage ici — la
    publication refait l'étiquetage en tâche de fond comme avant."""
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=422, detail="Position invalide")
    return {"label": geocode.reverse(lat, lng)}
