"""
Règle de déblocage réciproque — la mécanique centrale de BeUs.

On voit le souvenir de l'autre pour un jour donné uniquement après avoir soi-même
rempli ce jour-là. Ni la quantité, ni l'ordre d'arrivée : seulement le jour.

Pourquoi le jour et non plus un compteur : avec « mon 5ᵉ ouvre son 5ᵉ », un
souvenir supprimé ou un jour sauté désalignait les deux comptes pour toujours.
Avec le jour, chaque journée se répond à elle-même, et un jour manqué se comble
(services/jour.py, fenêtre de rattrapage) sans rien décaler.

Fonction pure, testée isolément (voir backend/test_reveal.py) : aucune requête
DB ici, viewer_days est calculé en amont par db.jours_remplis().
"""


def is_unlocked(post_day: str | None, post_author_id: str, viewer_id: str,
                 viewer_days: set[str]) -> bool:
    """On voit toujours ses propres souvenirs. Pour ceux de l'autre : débloqué
    dès qu'on a rempli le même jour.

    Un souvenir sans jour (ligne antérieure à la migration, jamais datée) reste
    verrouillé pour l'autre : en cas de doute, on ne montre pas."""
    if post_author_id == viewer_id:
        return True
    if not post_day:
        return False
    return post_day in viewer_days
