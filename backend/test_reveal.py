"""
Table de vérité du déblocage. La règle porte sur le JOUR, plus sur un compteur :
remplir le 20/09 ouvre le 20/09 de l'autre, et rien d'autre.
"""
import sys, os
sys.path.insert(0, os.getcwd())
from services.reveal import is_unlocked  # noqa: E402

J20, J21, J22 = "2026-09-20", "2026-09-21", "2026-09-22"

cas = [
    # (label, post_day, post_author, viewer, jours du viewer, attendu)
    ("aucun jour rempli, rien débloqué",          J22, "sam", "alex", set(), False),
    ("même jour rempli -> débloqué",              J22, "sam", "alex", {J22}, True),
    ("autre jour rempli -> toujours fermé",       J22, "sam", "alex", {J21}, False),
    ("un jour n'ouvre que lui-même",              J20, "sam", "alex", {J21, J22}, False),
    ("rattrapage : J-2 comblé, J-2 s'ouvre",      J20, "sam", "alex", {J20, J22}, True),
    ("les jours ouverts le restent",              J21, "sam", "alex", {J20, J21, J22}, True),
    ("ses propres souvenirs, sans rien remplir",  J22, "alex", "alex", set(), True),
    ("ses propres souvenirs, cas général",        J20, "alex", "alex", {J22}, True),
    ("symétrique dans l'autre sens",              J21, "alex", "sam", {J21}, True),
    ("souvenir sans jour : fermé pour l'autre",   None, "sam", "alex", {J20, J21, J22}, False),
    ("souvenir sans jour : visible par l'auteur", None, "alex", "alex", set(), True),
]

print(f"{'CAS':<46}{'ATTENDU':>9}{'OBTENU':>9}")
print("-" * 66)
ok = True
for label, day, author, viewer, jours, attendu in cas:
    obtenu = is_unlocked(day, author, viewer, jours)
    if obtenu != attendu:
        ok = False
    print(f"{label:<46}{str(attendu):>9}{str(obtenu):>9}  {'OK' if obtenu == attendu else 'ÉCHEC'}")
print("-" * 66)
sys.exit(0 if ok else 1)
