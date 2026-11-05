"""Série à deux : jours consécutifs remplis par les deux, sans casser avant minuit."""
import sys, os
sys.path.insert(0, os.getcwd())
from services.serie import serie  # noqa: E402

J = lambda n: f"2026-09-{n:02d}"
cas = [
    ("rien", set(), J(24), 0),
    ("aujourd'hui seulement", {J(24)}, J(24), 1),
    ("trois jours finissant aujourd'hui", {J(22), J(23), J(24)}, J(24), 3),
    ("aujourd'hui pas encore fait : on compte jusqu'à hier", {J(22), J(23)}, J(24), 2),
    ("trou avant-hier : la série repart", {J(20), J(22), J(23)}, J(24), 2),
    ("dernier jour commun il y a 2 jours : cassée", {J(21), J(22)}, J(24), 0),
    ("changement de mois", {"2026-08-31", "2026-09-01"}, "2026-09-01", 2),
]
ok = True
for label, jours, auj, attendu in cas:
    obtenu = serie(jours, auj)
    ok &= obtenu == attendu
    print(f"{'OK   ' if obtenu == attendu else 'ÉCHEC'} {label:<52} {obtenu}")
sys.exit(0 if ok else 1)
