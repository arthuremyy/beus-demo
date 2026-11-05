"""
La série à deux : combien de jours d'affilée les DEUX ont raconté leur journée.

Fonction pure (test_serie.py). La série se termine aujourd'hui si les deux ont
déjà publié, sinon hier : elle n'est pas « cassée » tant que la journée en
cours n'est pas finie — sinon elle retomberait à zéro chaque matin.
"""
from datetime import date, timedelta


def serie(jours_communs: set[str], aujourdhui: str) -> int:
    d = date.fromisoformat(aujourdhui)
    if d.isoformat() not in jours_communs:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in jours_communs:
        n += 1
        d -= timedelta(days=1)
    return n
