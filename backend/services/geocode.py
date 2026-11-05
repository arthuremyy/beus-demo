"""
Nom de lieu à partir des coordonnées (Nominatim / OpenStreetMap).

Un appel par post, au moment de la publication, puis stocké définitivement
dans posts.location_label : on ne re-géocode jamais un post déjà étiqueté.
C'est ce qui garde l'usage dans la politique de Nominatim (pas de requêtes
systématiques, pas d'auto-complétion) — plus le plafond de 1 req/s ci-dessous
et un User-Agent identifiant le service.

Échec = non bloquant : un post sans nom de lieu reste parfaitement valide,
il affiche juste ses coordonnées.
"""
import json
import logging
import re
import threading
import time
import urllib.parse
import urllib.request

logger = logging.getLogger("beus.geocode")

ENDPOINT = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "BeUs/1.0 (+https://beus.example.com)"
MIN_INTERVAL = 1.1  # politique Nominatim : 1 req/s maximum
TIMEOUT = 8

_lock = threading.Lock()
_last_call = 0.0


def _throttle():
    global _last_call
    with _lock:
        delta = time.monotonic() - _last_call
        if delta < MIN_INTERVAL:
            time.sleep(MIN_INTERVAL - delta)
        _last_call = time.monotonic()


# Bruit administratif renvoyé par OSM. Les découpages officiels (« Stadtbezirk
# 3 », « Paris 4e Arrondissement », « Kreisfreie Stadt Köln ») n'aident pas à
# situer un souvenir et ne tiennent pas dans une pastille de deux lignes.
# France et Allemagne d'abord — c'est là que vivent les deux comptes ; les
# formes hispanophones restent, elles ne coûtent rien en voyage.
_PREFIXES = re.compile(
    r"^("
    # France
    r"commune de|arrondissement de|quartier|ville de|"
    # Allemagne
    r"stadtbezirk|stadtteil|ortsbezirk|ortsteil|kreisfreie stadt|landkreis|"
    r"gemeinde|verbandsgemeinde|samtgemeinde|regierungsbezirk|bezirk|"
    # espagnol (voyages)
    r"per[ií]metro urbano|localidad|comuna\s*\d*\s*-?\s*|municipio de|ciudad de"
    r")\s+", re.I)
# « Paris 4e Arrondissement », « Lyon 3e »
_ARRONDISSEMENT = re.compile(r"\s*\d+\s*(?:er|[èe]me|e)\s*(?:arrondissement)?\s*$", re.I)
# « Stadtbezirk 3 », « Bezirk 12 » : le numéro seul ne situe rien
_BEZIRK_NUM = re.compile(r"^\d+$")
MAX_LEN = 42


def _nettoie(part: str | None) -> str | None:
    if not part:
        return None
    p = _ARRONDISSEMENT.sub("", str(part)).strip()
    p = _PREFIXES.sub("", p).strip(" -–,")
    # « Comuna 11 - Laureles-Estadio » -> « Laureles-Estadio »
    if " - " in p:
        p = p.split(" - ")[-1].strip()
    # « Stadtbezirk 3 » réduit à « 3 » : plus rien d'exploitable.
    if _BEZIRK_NUM.match(p):
        return None
    return p or None


def _shorten(address: dict) -> str | None:
    """« Laureles-Estadio, Medellín » plutôt que l'adresse postale complète : on
    veut situer le souvenir, pas livrer un colis. Deux composants maximum.

    Quand « quartier, ville » dépasse la place disponible, on RACCOURCIT le
    quartier au lieu de supprimer la ville : sans la ville, un nom de quartier
    seul (« Capitole / Arnaud Bernard / Carmes ») ne situe plus rien."""
    ville = _nettoie(address.get("city") or address.get("town") or address.get("village")
                      or address.get("municipality") or address.get("county"))
    quartier = _nettoie(address.get("neighbourhood") or address.get("suburb")
                         or address.get("city_district") or address.get("hamlet"))
    pays = _nettoie(address.get("country"))

    if quartier and ville and quartier.lower() != ville.lower():
        # Un quartier à rallonge (listes « A / B / C ») : on garde la 1re partie.
        if len(quartier) + len(ville) + 2 > MAX_LEN:
            quartier = quartier.split(" / ")[0].split(", ")[0].strip()
        place = MAX_LEN - len(ville) - 2
        if len(quartier) > place:
            quartier = quartier[:max(1, place - 1)].rstrip(" -,") + "…" if place > 6 else None
        return f"{quartier}, {ville}" if quartier else ville
    if ville:
        if pays and pays.lower() != ville.lower() and len(ville) + len(pays) + 2 <= MAX_LEN:
            return f"{ville}, {pays}"
        return ville
    parts = [p for p in (quartier, pays) if p]
    label = ", ".join(parts[:2])
    return (label[:MAX_LEN - 1] + "…") if len(label) > MAX_LEN else (label or None)


def situe(address: dict) -> tuple[str | None, str | None]:
    """Le lieu STRUCTURÉ, à côté du libellé lisible : la ville seule et le code
    pays ISO. Les médailles comptent des villes et des pays — compter sur du
    texte libre (« Laureles-Estadio, Medellín ») ferait de chaque quartier une
    ville nouvelle.

    Le pays est gardé en code ISO (FR, DE) et non en nom : le nom dépend de la
    langue demandée à Nominatim, le code non. L'affichage traduira."""
    ville = _nettoie(address.get("city") or address.get("town")
                      or address.get("village") or address.get("municipality"))
    code = address.get("country_code")
    return ville, (str(code).upper() if code else None)


def reverse_details(lat: float, lng: float) -> dict | None:
    """Un seul appel Nominatim, deux usages : le libellé affiché et le lieu
    structuré. Ne jamais appeler deux fois pour le même souvenir."""
    params = urllib.parse.urlencode({
        "format": "jsonv2", "lat": f"{lat:.6f}", "lon": f"{lng:.6f}",
        "zoom": 14, "accept-language": "fr",
    })
    req = urllib.request.Request(f"{ENDPOINT}?{params}", headers={"User-Agent": USER_AGENT})
    try:
        _throttle()
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # réseau, quota, JSON cassé : non bloquant
        logger.warning("géocodage inverse indisponible (%s)", e)
        return None
    address = data.get("address") or {}
    ville, pays = situe(address)
    return {"label": _shorten(address), "city": ville, "country": pays}


def reverse(lat: float, lng: float) -> str | None:
    """Le libellé seul. Conservé pour les appels qui n'ont pas besoin du lieu
    structuré ; ne PAS l'enchaîner avec reverse_details() sur le même souvenir,
    ce serait deux requêtes Nominatim pour une seule position."""
    d = reverse_details(lat, lng)
    return d["label"] if d else None
