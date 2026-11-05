"""
Le jour de BeUs est parisien. Ce test existe pour un piège précis : created_at
vient de CURRENT_TIMESTAMP SQLite, donc de l'UTC. Un souvenir publié juste après
minuit à Paris est daté de la VEILLE en UTC — et la journée du jour paraîtrait
libre. Le bug serait invisible en journée et ne sortirait que la nuit.
"""
import sys, os
from datetime import datetime, timezone

sys.path.insert(0, os.getcwd())
from services import jour  # noqa: E402

AUJ = "2026-09-22"


def utc(txt):
    return datetime.strptime(txt, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


cas = []


def verifie(label, obtenu, attendu):
    cas.append((label, attendu, obtenu, obtenu == attendu))


# ── Bascule de journée, heure d'été (UTC+2) ──────────────────────────────────
verifie("21/09 21:59 UTC -> 21/09 (23:59 Paris)",
        jour.jour_de(utc("2026-09-21 21:59:00")), "2026-09-21")
verifie("21/09 22:00 UTC -> 22/09 (00:00 Paris)",
        jour.jour_de(utc("2026-09-21 22:00:00")), "2026-09-22")
verifie("22/09 00:30 UTC -> 22/09 (02:30 Paris)",
        jour.jour_de(utc("2026-09-22 00:30:00")), "2026-09-22")

# ── Bascule de journée, heure d'hiver (UTC+1) ────────────────────────────────
verifie("15/01 22:59 UTC -> 15/01 (23:59 Paris)",
        jour.jour_de(utc("2026-01-15 22:59:00")), "2026-01-15")
verifie("15/01 23:00 UTC -> 16/01 (00:00 Paris)",
        jour.jour_de(utc("2026-01-15 23:00:00")), "2026-01-16")

# ── Conversion depuis la colonne created_at (forme SQLite) ───────────────────
verifie("created_at SQLite franchit minuit",
        jour.jour_de_created_at("2026-09-21 22:30:00"), "2026-09-22")
verifie("created_at avec fraction de seconde",
        jour.jour_de_created_at("2026-09-21 22:30:00.123"), "2026-09-22")
verifie("created_at vide -> pas de jour",
        jour.jour_de_created_at(""), None)
verifie("created_at illisible -> pas de jour",
        jour.jour_de_created_at("n'importe quoi"), None)
verifie("heure parisienne d'un souvenir de nuit",
        jour.heure_de_created_at("2026-09-21 22:30:00"), 0)
verifie("heure parisienne d'un souvenir du matin",
        jour.heure_de_created_at("2026-09-22 04:10:00"), 6)

# ── Fenêtre de rattrapage ────────────────────────────────────────────────────
f = jour.fenetre(AUJ)
verifie("la fenêtre couvre aujourd'hui + la veille", len(f), 2)
verifie("elle commence aujourd'hui", f[0], AUJ)
verifie("elle s'arrête à la veille", f[-1], "2026-09-21")

verifie("jour absent -> aujourd'hui", jour.valide(None, AUJ), AUJ)
verifie("jour vide -> aujourd'hui", jour.valide("", AUJ), AUJ)
verifie("aujourd'hui accepté", jour.valide(AUJ, AUJ), AUJ)
verifie("la veille acceptée (dernière limite)", jour.valide("2026-09-21", AUJ), "2026-09-21")


def refuse(label, valeur):
    try:
        jour.valide(valeur, AUJ)
    except jour.JourInvalide:
        cas.append((label, "refus", "refus", True))
    else:
        cas.append((label, "refus", "accepté", False))


# Le cœur de la règle : l'avant-veille est CLOSE. Personne ne la comblera plus,
# et le souvenir que l'autre y a laissé restera verrouillé pour toujours.
refuse("l'avant-veille refusée (journée close)", "2026-09-20")
refuse("une semaine en arrière refusée", "2026-09-15")
refuse("demain refusé", "2026-09-23")
refuse("forme invalide refusée", "22/09/2026")
refuse("texte libre refusé", "hier")

verifie("aujourd'hui n'est pas un rattrapage", jour.est_rattrapage(AUJ, AUJ), False)
verifie("la veille est un rattrapage", jour.est_rattrapage("2026-09-21", AUJ), True)

print(f"{'CAS':<48}{'ATTENDU':>12}{'OBTENU':>12}")
print("-" * 78)
ok = True
for label, attendu, obtenu, bon in cas:
    if not bon:
        ok = False
    print(f"{label:<48}{str(attendu):>12}{str(obtenu):>12}  {'OK' if bon else 'ÉCHEC'}")
print("-" * 78)
sys.exit(0 if ok else 1)
