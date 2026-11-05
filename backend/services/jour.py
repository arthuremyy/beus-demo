"""
Le jour calendaire de BeUs — en heure de Paris, jamais en UTC.

Toute la mécanique (un souvenir par jour, rattrapage, déblocage) repose sur une
chaîne 'YYYY-MM-DD'. Elle est calculée ICI, au moment de l'insertion, et stockée
dans posts.day. Elle n'est JAMAIS re-dérivée de created_at à la lecture.

Pourquoi : created_at vient de CURRENT_TIMESTAMP SQLite, donc de l'UTC. En
dérivant le jour à la lecture, un souvenir publié le mardi à 00h30 à Paris
(= lundi 22h30 UTC) compterait pour lundi, et la journée de mardi paraîtrait
libre. L'été, la bascule se ferait à 02h00 locales. Le décalage serait invisible
en journée et ne se manifesterait que la nuit — exactement le moment où on
publie « juste avant minuit ».

Fonctions pures : l'instant courant est toujours un paramètre, pour que les
tests puissent se placer à 23h59 comme à 00h01 (voir backend/test_jour.py).
"""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from config import settings

# Combien de jours en arrière on peut encore combler : UN SEUL, la veille.
#
# La règle complète : on publie pour aujourd'hui pendant toute la journée, et on
# a encore la journée SUIVANTE pour combler celle qu'on a ratée. Passé ce
# délai — 24 h après la fin du jour concerné — la journée est close.
#
# Et close veut dire définitif dans les DEUX sens : le déblocage se faisant par
# jour (services/reveal.py), qui n'a pas rempli le sien ne verra JAMAIS celui
# de l'autre pour cette date-là. C'est volontaire : c'est ce qui donne du poids
# au rendez-vous quotidien. Une fenêtre large (on était à 7) le vidait de son
# sens et remplissait le journal de journées « à rattraper » dès le premier
# jour d'utilisation, alors qu'il n'y avait encore rien à rattraper.
FENETRE_RATTRAPAGE = 1

_ZONE = ZoneInfo(settings.tz)


class JourInvalide(ValueError):
    """Jour mal formé, dans le futur, ou hors de la fenêtre de rattrapage."""


def zone() -> ZoneInfo:
    return _ZONE


def maintenant() -> datetime:
    return datetime.now(timezone.utc)


def jour_de(instant: datetime) -> str:
    """Le jour parisien d'un instant donné (aware, quelle que soit sa zone)."""
    if instant.tzinfo is None:
        raise ValueError("instant naïf : la zone doit être explicite")
    return instant.astimezone(_ZONE).date().isoformat()


def aujourdhui(instant: datetime | None = None) -> str:
    return jour_de(instant or maintenant())


def jour_de_created_at(created_at: str) -> str | None:
    """Convertit un created_at SQLite ('YYYY-MM-DD HH:MM:SS', UTC) en jour
    parisien. Sert UNIQUEMENT à la migration des lignes antérieures à la
    colonne day — le code courant lit posts.day, il ne recalcule rien."""
    if not created_at:
        return None
    texte = created_at.strip().replace("T", " ").split(".")[0]
    try:
        brut = datetime.strptime(texte, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            brut = datetime.strptime(texte[:10], "%Y-%m-%d")
        except ValueError:
            return None
        return brut.date().isoformat()
    return jour_de(brut.replace(tzinfo=timezone.utc))


def heure_de_created_at(created_at: str) -> int | None:
    """L'heure parisienne (0-23) d'un souvenir — pour les médailles « avant le
    jour » / « après la nuit », qui n'auraient aucun sens en UTC."""
    if not created_at:
        return None
    texte = created_at.strip().replace("T", " ").split(".")[0]
    try:
        brut = datetime.strptime(texte, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return brut.replace(tzinfo=timezone.utc).astimezone(_ZONE).hour


def fenetre(reference: str | None = None) -> list[str]:
    """Les jours comblables, du plus récent au plus ancien : aujourd'hui puis
    les FENETRE_RATTRAPAGE jours précédents."""
    ref = date.fromisoformat(reference or aujourdhui())
    return [(ref - timedelta(days=n)).isoformat()
            for n in range(FENETRE_RATTRAPAGE + 1)]


def valide(jour: str | None, reference: str | None = None) -> str:
    """Normalise le jour demandé à la publication. Absent -> aujourd'hui.
    Lève JourInvalide si la forme est mauvaise, s'il est dans le futur, ou
    s'il est trop ancien pour être encore comblé."""
    ref = reference or aujourdhui()
    if jour is None or jour == "":
        return ref
    try:
        demande = date.fromisoformat(jour.strip()).isoformat()
    except ValueError:
        raise JourInvalide("jour mal formé (attendu AAAA-MM-JJ)")
    if demande > ref:
        raise JourInvalide("on ne publie pas dans le futur")
    if demande not in fenetre(ref):
        raise JourInvalide(
            "trop tard : on ne peut plus combler que la veille")
    return demande


def est_rattrapage(jour: str, reference: str | None = None) -> bool:
    return jour != (reference or aujourdhui())
