"""
Rappels quotidiens — une notification à 15 h, une dernière à 21 h, pour qui
n'a pas encore raconté sa journée.

Tout tourne dans le conteneur (boucle asyncio lancée par le lifespan), comme
le reste de BeUs : aucun cron hôte.

Deux garanties :
  · UN envoi par créneau, par compte et par jour, même si le conteneur
    redémarre : la clé `meta` rappel:<jour>:<créneau>:<compte> est posée AVANT
    l'envoi (un envoi perdu vaut mieux qu'un rappel en double) ;
  · pas de rappel à contretemps : un créneau manqué de moins de
    RATTRAPAGE_MIN (redémarrage) part encore ; au-delà, on l'abandonne — un
    « rappel de 15 h » reçu à 18 h n'a plus de sens.

Le texte ne porte JAMAIS la légende de l'autre : son souvenir est verrouillé
pour le destinataire tant que celui-ci n'a pas publié, et c'est justement le
cas de quelqu'un qu'on relance.

La décision est une fonction PURE (a_envoyer), testée dans test_rappels.py.
"""
import asyncio
import logging
import os
from datetime import datetime

import db
from services import jour, push

logger = logging.getLogger("beus.rappels")

# (heure, minute, nom du créneau). Surchargeable pour les essais :
# BEUS_RAPPEL_HEURES="21:47,21:49".
CRENEAUX: list[tuple[int, int, str]] = [(15, 0, "premier"), (21, 0, "dernier")]
RATTRAPAGE_MIN = 30
PERIODE_S = 60


def _creneaux() -> list[tuple[int, int, str]]:
    brut = os.getenv("BEUS_RAPPEL_HEURES", "").strip()
    if not brut:
        return CRENEAUX
    noms = ["premier", "dernier"]
    out = []
    for i, morceau in enumerate(brut.split(",")[:2]):
        h, m = morceau.strip().split(":")
        out.append((int(h), int(m), noms[i]))
    return out


def cle(day: str, creneau: str, user_id: str) -> str:
    return f"rappel:{day}:{creneau}:{user_id}"


def a_envoyer(local: datetime, comptes: list[str], remplis: set[str],
              deja: set[str], creneaux=None) -> list[tuple[str, str]]:
    """Les (compte, créneau) à relancer MAINTENANT.

    `local` : l'heure de Paris. `remplis` : les comptes qui ont déjà publié
    aujourd'hui. `deja` : les clés déjà posées dans meta."""
    creneaux = creneaux or CRENEAUX
    day = local.date().isoformat()
    minutes = local.hour * 60 + local.minute
    out = []
    for h, m, nom in creneaux:
        ecart = minutes - (h * 60 + m)
        if not 0 <= ecart < RATTRAPAGE_MIN:
            continue
        for u in comptes:
            if u in remplis or cle(day, nom, u) in deja:
                continue
            out.append((u, nom))
    return out


def texte(creneau: str, autre_nom: str | None, autre_a_publie: bool) -> tuple[str, str]:
    """(titre, corps) de la notification."""
    if creneau == "dernier":
        return "BeUs", "Dernier rappel : plus que 3 h pour publier ton souvenir"
    if autre_a_publie and autre_nom:
        return "BeUs", f"{autre_nom} a publié son souvenir. Publie le tien pour le voir"
    return "BeUs", "Tu n’as pas encore publié ton souvenir du jour"


def passe(local: datetime | None = None) -> list[tuple[str, str]]:
    """Un tour : décide, pose les clés, envoie. Retourne ce qui a été envoyé."""
    local = local or jour.maintenant().astimezone(jour.zone())
    day = local.date().isoformat()
    creneaux = _creneaux()
    with db.connect() as conn:
        comptes = {r["id"]: r["display_name"] for r in conn.execute(
            "SELECT id, display_name FROM users")}
        remplis = {u for u in comptes if db.jour_rempli(conn, u, day)}
        deja = {r["key"] for r in conn.execute(
            "SELECT key FROM meta WHERE key LIKE ?", (f"rappel:{day}:%",))}
        cibles = a_envoyer(local, list(comptes), remplis, deja, creneaux)
        for u, nom in cibles:
            db.set_meta(conn, cle(day, nom, u), local.isoformat(timespec="minutes"))
        conn.commit()
    for u, nom in cibles:
        autre = next((a for a in comptes if a != u), None)
        titre, corps = texte(nom, comptes.get(autre), autre in remplis)
        # Même tag pour les deux créneaux : le rappel de 21 h REMPLACE celui
        # de 15 h sur l'écran verrouillé au lieu de s'empiler.
        push.envoie(u, titre, corps, url="/#/capture", tag=f"rappel-{day}")
        logger.info("rappel %s envoyé à %s (%s)", nom, u, day)
    return cibles


async def boucle():
    creneaux = _creneaux()
    logger.info("rappels actifs : %s", ", ".join(f"{h:02d}:{m:02d}" for h, m, _ in creneaux))
    while True:
        try:
            await asyncio.to_thread(passe)
        except Exception:
            logger.exception("passe de rappels en échec")
        await asyncio.sleep(PERIODE_S)
