"""Rappels : bon créneau, rattrapage court, jamais de doublon ni de rappel inutile."""
import sys, os
sys.path.insert(0, os.getcwd())
os.environ.setdefault("BEUS_JWT_SECRET", "test")
from datetime import datetime  # noqa: E402
from services.rappels import a_envoyer, cle, texte  # noqa: E402

C = ["alex", "sam"]
d = lambda h, m: datetime(2026, 9, 24, h, m)
cas = [
    ("14:59 : rien", a_envoyer(d(14, 59), C, set(), set()), []),
    ("15:00 : les deux", a_envoyer(d(15, 0), C, set(), set()), [("alex", "premier"), ("sam", "premier")]),
    ("15:00, sam a publié : alex seul", a_envoyer(d(15, 0), C, {"sam"}, set()), [("alex", "premier")]),
    ("15:10 après redémarrage : rattrapé", a_envoyer(d(15, 10), C, set(), set()), [("alex", "premier"), ("sam", "premier")]),
    ("15:30 : trop tard, abandonné", a_envoyer(d(15, 30), C, set(), set()), []),
    ("15:01 déjà envoyé : pas de doublon",
     a_envoyer(d(15, 1), C, set(), {cle("2026-09-24", "premier", "alex"), cle("2026-09-24", "premier", "sam")}), []),
    ("21:00 : dernier rappel", a_envoyer(d(21, 0), C, {"alex"}, set()), [("sam", "dernier")]),
    ("23:00 : rien", a_envoyer(d(23, 0), C, set(), set()), []),
    ("tous remplis : rien", a_envoyer(d(21, 5), C, {"alex", "sam"}, set()), []),
    ("texte 15 h si l'autre a publié", texte("premier", "Sam", True)[1], "Sam a publié son souvenir. Publie le tien pour le voir"),
    ("texte 21 h", texte("dernier", "Sam", True)[1], "Dernier rappel : plus que 3 h pour publier ton souvenir"),
]
ok = True
for label, obtenu, attendu in cas:
    ok &= obtenu == attendu
    print(f"{'OK   ' if obtenu == attendu else 'ÉCHEC'} {label:<42} {obtenu!r}"[:120])
sys.exit(0 if ok else 1)
