"""
Étiquetage des posts : un nom de lieu par post, écrit une seule fois — plus le
lieu STRUCTURÉ (ville, code pays) qui alimente les médailles.

Deux points d'entrée, un seul chemin de code :
  - à la publication (tâche de fond, la réponse d'upload n'attend pas le réseau)
  - au démarrage, pour rattraper les posts antérieurs — PLAFONNÉ, jamais en
    boucle : Nominatim interdit les requêtes systématiques.
"""
import logging

import db
from services import geocode

BACKFILL_MAX = 25

logger = logging.getLogger("beus.labels")


def label_post(post_id: int, lat: float, lng: float):
    """Géocode puis écrit le libellé ET le lieu structuré, en UN seul appel
    réseau. Silencieux en cas d'échec : un souvenir sans lieu reste valide.

    Le libellé n'est écrit que s'il manque (le client peut en avoir fourni un) ;
    ville et pays sont écrits sans condition — ils ne viennent que d'ici."""
    d = geocode.reverse_details(lat, lng)
    if not d:
        return
    with db.connect() as conn:
        conn.execute(
            "UPDATE posts SET location_label=COALESCE(location_label, ?), "
            "city=?, country=? WHERE id=?",
            (d["label"], d["city"], d["country"], post_id))
        conn.commit()
    logger.info("post %s étiqueté : %s (%s / %s)", post_id, d["label"], d["city"], d["country"])


def backfill():
    with db.connect() as conn:
        manquants = db.rows(conn.execute(
            "SELECT id, lat, lng FROM posts WHERE deleted_at IS NULL "
            "AND (location_label IS NULL OR country IS NULL) AND lat IS NOT NULL "
            "ORDER BY id DESC LIMIT ?", (BACKFILL_MAX,)))
    if not manquants:
        return
    logger.info("étiquetage de %d souvenir(s) sans lieu complet", len(manquants))
    for p in manquants:  # geocode applique lui-même le 1 req/s
        label_post(p["id"], p["lat"], p["lng"])
