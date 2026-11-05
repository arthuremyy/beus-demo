"""
Médailles — deux familles : ce que je fais seul, ce qu'on fait ensemble.

Principe du dépôt : tout se dérive de la table posts, rien ne s'écrit à la main
(services/reveal.py, services/stats.py). Une médaille fait exception sur UN
point : elle a une date d'obtention, et elle ne doit être fêtée qu'une fois.
D'où le partage :

  - la CONDITION reste dérivée, recalculable à tout moment, jamais stockée ;
  - l'ATTRIBUTION est persistée (table medailles), une seule ligne par médaille.

Conséquence à ne pas casser : une médaille obtenue le reste. Si un souvenir est
supprimé et que la condition redevient fausse, la ligne n'est PAS retirée — on
ne reprend pas ce qui a été gagné.

Les règles (`CATALOGUE`) sont des fonctions pures d'un état déjà agrégé : elles
se testent sans base ni réseau (voir backend/test_medals.py). Aucune ne touche
à la DB.

⚠ La distance n'est JAMAIS affichée nulle part dans l'app — décision produit :
BeUs doit dire la même chose quand les deux comptes sont dans la même pièce et
quand ils sont à l'autre bout du monde. Elle ne sert qu'ici, à trancher si deux
souvenirs du même jour ont été pris côte à côte.
"""
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from math import asin, cos, radians, sin, sqrt
from typing import Callable

import db
from services import jour as jour_svc

logger = logging.getLogger("beus.medals")

SOLO, COUPLE = "solo", "couple"

# Deux souvenirs du même jour à moins de 100 m : on était ensemble. Le seuil est
# large exprès — le GPS d'un téléphone en ville se trompe couramment de 20 à
# 50 m, et deux personnes côte à côte peuvent être rendues à 80 m l'une de
# l'autre. Un seuil serré ne mesurerait que la qualité du signal.
RAYON_COTE_A_COTE_M = 100
# Même minute, à cinq minutes près : le temps de se le dire et de dégainer.
ECART_SYNCHRO_S = 5 * 60
# Avant 07:00 / après 23:00, heure de Paris (jamais UTC : ces deux médailles
# parlent du lever et du coucher, pas d'un fuseau).
HEURE_TOT, HEURE_TARD = 7, 23


def distance_m(lat1, lng1, lat2, lng2) -> float:
    """Haversine. Usage interne exclusif (voir l'avertissement en tête)."""
    if None in (lat1, lng1, lat2, lng2):
        return float("inf")
    r = 6371000.0
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(sqrt(a))


def plus_longue_serie(jours: set[str]) -> int:
    """Le plus long enchaînement de jours consécutifs. Passe les fins de mois et
    les changements d'année sans rien de particulier : on compare des dates,
    jamais des chaînes."""
    if not jours:
        return 0
    dates = sorted(date.fromisoformat(j) for j in jours)
    record = courante = 1
    for precedent, suivant in zip(dates, dates[1:]):
        courante = courante + 1 if suivant - precedent == timedelta(days=1) else 1
        record = max(record, courante)
    return record


@dataclass(frozen=True)
class Medaille:
    code: str
    famille: str
    titre: str
    description: str
    cible: int
    mesure: Callable[[dict], int]   # état -> avancement, toujours un entier


CATALOGUE: tuple[Medaille, ...] = (
    # ── Seul ────────────────────────────────────────────────────────────────
    Medaille("premier", SOLO, "Premier jour",
             "Publier son premier souvenir.", 1, lambda e: len(e["jours"])),
    Medaille("dix", SOLO, "Dix jours",
             "Dix journées racontées.", 10, lambda e: len(e["jours"])),
    Medaille("cinquante", SOLO, "Cinquante",
             "Cinquante journées racontées.", 50, lambda e: len(e["jours"])),
    Medaille("cent", SOLO, "Cent",
             "Cent journées racontées.", 100, lambda e: len(e["jours"])),
    Medaille("annee", SOLO, "Une année",
             "Trois cent soixante-cinq journées.", 365, lambda e: len(e["jours"])),
    Medaille("villes_5", SOLO, "Cinq villes",
             "Des souvenirs dans cinq villes différentes.", 5,
             lambda e: len(e["villes"])),
    Medaille("pays_2", SOLO, "Deux pays",
             "Un souvenir hors de son pays.", 2, lambda e: len(e["pays"])),
    Medaille("leve_tot", SOLO, "Avant le jour",
             "Un souvenir publié avant 7 h du matin.", 1,
             lambda e: sum(1 for h in e["heures"] if h is not None and h < HEURE_TOT)),
    Medaille("couche_tard", SOLO, "Après la nuit",
             "Un souvenir publié après 23 h.", 1,
             lambda e: sum(1 for h in e["heures"] if h is not None and h >= HEURE_TARD)),

    # ── À deux ──────────────────────────────────────────────────────────────
    Medaille("cote_a_cote", COUPLE, "Côte à côte",
             "Deux souvenirs du même jour, pris au même endroit.", 1,
             lambda e: len(e["cote_a_cote"])),
    Medaille("cote_a_cote_10", COUPLE, "Dix fois côte à côte",
             "Dix journées passées au même endroit.", 10,
             lambda e: len(e["cote_a_cote"])),
    Medaille("meme_ville", COUPLE, "Même ville",
             "Deux souvenirs du même jour, dans la même ville.", 1,
             lambda e: len(e["meme_ville"])),
    Medaille("synchro", COUPLE, "À la même minute",
             "Deux souvenirs du même jour à cinq minutes près.", 1,
             lambda e: len(e["synchro"])),
    Medaille("semaine", COUPLE, "Une semaine à deux",
             "Sept jours d'affilée remplis par tous les deux.", 7,
             lambda e: plus_longue_serie(e["jours_communs"])),
    Medaille("mois", COUPLE, "Un mois à deux",
             "Trente jours d'affilée remplis par tous les deux.", 30,
             lambda e: plus_longue_serie(e["jours_communs"])),
)

PAR_CODE = {m.code: m for m in CATALOGUE}


def etat_vide() -> dict:
    return {"jours": set(), "villes": set(), "pays": set(), "heures": [],
            "jours_communs": set(), "cote_a_cote": set(), "meme_ville": set(),
            "synchro": set()}


def evalue(etat: dict) -> set[str]:
    """Les codes dont la condition est remplie. Fonction pure."""
    return {m.code for m in CATALOGUE if m.mesure(etat) >= m.cible}


def avancement(etat: dict) -> dict[str, int]:
    """L'avancement de CHAQUE médaille, plafonné à sa cible — c'est ce qui
    s'affiche sous une médaille pas encore gagnée (« 7 / 10 »)."""
    return {m.code: min(m.mesure(etat), m.cible) for m in CATALOGUE}


# ── Agrégation depuis la base ────────────────────────────────────────────────

def _secondes(created_at: str | None) -> float | None:
    if not created_at:
        return None
    from datetime import datetime, timezone
    texte = created_at.strip().replace("T", " ").split(".")[0]
    try:
        return datetime.strptime(texte, "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=timezone.utc).timestamp()
    except ValueError:
        return None


def _mes_souvenirs(conn, user_id: str) -> list[dict]:
    return db.rows(conn.execute(
        "SELECT day, lat, lng, city, country, created_at FROM posts "
        "WHERE author_id=? AND deleted_at IS NULL AND day IS NOT NULL", (user_id,)))


def agrege(conn, user_id: str) -> dict:
    """Construit l'état des deux familles pour un compte. Les médailles de
    couple sont les mêmes pour les deux : elles décrivent des journées, pas
    une personne."""
    etat = etat_vide()
    autre_row = conn.execute("SELECT id FROM users WHERE id<>? LIMIT 1", (user_id,)).fetchone()

    miens = _mes_souvenirs(conn, user_id)
    for p in miens:
        etat["jours"].add(p["day"])
        if p["city"]:
            etat["villes"].add(p["city"])
        if p["country"]:
            etat["pays"].add(p["country"])
        etat["heures"].append(jour_svc.heure_de_created_at(p["created_at"]))

    if not autre_row:
        return etat

    siens = {p["day"]: p for p in _mes_souvenirs(conn, autre_row["id"])}
    par_jour = {p["day"]: p for p in miens}
    etat["jours_communs"] = set(par_jour) & set(siens)

    for j in etat["jours_communs"]:
        a, b = par_jour[j], siens[j]
        if distance_m(a["lat"], a["lng"], b["lat"], b["lng"]) <= RAYON_COTE_A_COTE_M:
            etat["cote_a_cote"].add(j)
        if a["city"] and b["city"] and a["city"].lower() == b["city"].lower():
            etat["meme_ville"].add(j)
        ta, tb = _secondes(a["created_at"]), _secondes(b["created_at"])
        if ta is not None and tb is not None and abs(ta - tb) <= ECART_SYNCHRO_S:
            etat["synchro"].add(j)
    return etat


def obtenues(conn, user_id: str) -> dict[str, str]:
    return {r["code"]: r["obtained_at"] for r in conn.execute(
        "SELECT code, obtained_at FROM medailles WHERE user_id=?", (user_id,))}


def attribue(conn, user_id: str) -> list[str]:
    """Enregistre les médailles nouvellement gagnées et retourne leurs codes.
    Idempotent : rappelé cent fois, il n'insère rien de plus."""
    etat = agrege(conn, user_id)
    gagnees = evalue(etat)
    deja = set(obtenues(conn, user_id))
    nouvelles = sorted(gagnees - deja)
    for code in nouvelles:
        conn.execute("INSERT OR IGNORE INTO medailles (user_id, code) VALUES (?,?)",
                      (user_id, code))
    if nouvelles:
        conn.commit()
        logger.info("médailles gagnées par %s : %s", user_id, ", ".join(nouvelles))
    return nouvelles


def attribue_tous(conn) -> dict[str, list[str]]:
    """Après une publication, les DEUX comptes peuvent gagner quelque chose :
    une médaille de couple se gagne à deux, et le souvenir qui la déclenche
    n'est publié que par l'un des deux.

    La liste est lue ENTIÈREMENT avant d'écrire : itérer un curseur encore
    ouvert tout en insérant forçait SQLite à promouvoir une lecture en
    écriture, et deux publications rapprochées levaient « database is locked »
    (sans attendre le busy_timeout)."""
    ids = [r["id"] for r in conn.execute("SELECT id FROM users ORDER BY id")]
    return {uid: attribue(conn, uid) for uid in ids}


def tableau(conn, user_id: str) -> dict:
    """Les deux familles telles qu'elles s'affichent sur le profil : obtenues
    d'abord, puis les suivantes avec leur avancement."""
    etat = agrege(conn, user_id)
    avance = avancement(etat)
    gagnees = obtenues(conn, user_id)
    familles: dict[str, list[dict]] = {SOLO: [], COUPLE: []}
    for m in CATALOGUE:
        familles[m.famille].append({
            "code": m.code, "titre": m.titre, "description": m.description,
            "famille": m.famille, "cible": m.cible, "avancement": avance[m.code],
            "obtenue": m.code in gagnees, "obtenue_le": gagnees.get(m.code),
        })
    for liste in familles.values():
        liste.sort(key=lambda d: (not d["obtenue"], d["cible"]))
    return {"solo": familles[SOLO], "couple": familles[COUPLE],
            "total_obtenues": len(gagnees), "total": len(CATALOGUE)}
