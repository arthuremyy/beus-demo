"""
Chiffres affichés en tête de carte.

Volontairement SANS notion de distance : l'app doit avoir le même sens quand
les deux comptes sont dans la même pièce et quand ils sont dans deux pays.
Ce qui compte, c'est ce qui reste à découvrir, pas l'écart entre les deux.

Rien n'est stocké : tout est dérivé des posts à la demande (même principe que
services/reveal.py — une seule source de vérité, la table posts).
"""
import db
from services import jour, medals, serie


def _dernier_post(conn, user_id: str) -> dict | None:
    r = conn.execute(
        "SELECT * FROM posts WHERE author_id=? AND deleted_at IS NULL "
        "ORDER BY created_at DESC LIMIT 1", (user_id,)).fetchone()
    return dict(r) if r else None


def compute(conn, viewer_id: str) -> dict:
    users = db.rows(conn.execute("SELECT id, display_name FROM users ORDER BY id"))
    par_compte = []
    for u in users:
        dernier = _dernier_post(conn, u["id"])
        par_compte.append({
            "id": u["id"], "display_name": u["display_name"],
            "total": len(db.jours_remplis(conn, u["id"])),
            "dernier_lieu": (dernier or {}).get("location_label"),
            "dernier_at": (dernier or {}).get("created_at"),
        })

    mes_jours = db.jours_remplis(conn, viewer_id)
    autres = [u["id"] for u in users if u["id"] != viewer_id]

    # Combien de souvenirs de l'autre attendent que je remplisse LEUR jour.
    # Le compte se fait par jour, plus par numéro : un souvenir de l'autre est
    # verrouillé tant que je n'ai rien publié ce jour-là, même si j'en ai
    # publié dix ailleurs.
    ses_jours = db.jours_remplis(conn, autres[0]) if autres else set()
    verrouilles = len(ses_jours - mes_jours)

    r = conn.execute("SELECT COUNT(*) AS n FROM posts WHERE deleted_at IS NULL").fetchone()
    aujourdhui = jour.aujourdhui()

    return {
        "comptes": par_compte,
        "mon_total": len(mes_jours),
        "verrouilles": verrouilles,
        "total_souvenirs": r["n"],
        "aujourdhui": aujourdhui,
        "aujourdhui_rempli": aujourdhui in mes_jours,
        # Jours d'affilée remplis par les DEUX (services/serie.py).
        "serie": serie.serie(medals.agrege(conn, viewer_id)["jours_communs"], aujourdhui),
        # Les jours passés encore comblables — ce qui reste vraiment à faire.
        "a_combler": [d for d in jour.fenetre(aujourdhui)
                       if d not in mes_jours and d != aujourdhui],
    }
