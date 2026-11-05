"""
Les règles des médailles, sans base ni réseau. On vise les bords : la veille du
palier, le palier exact, le seuil de distance au mètre, la série à cheval sur
un mois et sur une année.
"""
import sys, os
sys.path.insert(0, os.getcwd())
from services import medals  # noqa: E402

cas = []


def verifie(label, obtenu, attendu):
    cas.append((label, attendu, obtenu, obtenu == attendu))


def etat(**kw):
    e = medals.etat_vide()
    e.update(kw)
    return e


def jours(n, depart="2026-01-01"):
    from datetime import date, timedelta
    d = date.fromisoformat(depart)
    return {(d + timedelta(days=i)).isoformat() for i in range(n)}


# ── Paliers de volume : la veille ne compte pas, le jour même oui ────────────
verifie("0 souvenir : aucune médaille solo",
        medals.evalue(etat()) & {"premier", "dix"}, set())
verifie("1 souvenir : « premier »",
        "premier" in medals.evalue(etat(jours=jours(1))), True)
verifie("9 souvenirs : pas encore « dix »",
        "dix" in medals.evalue(etat(jours=jours(9))), False)
verifie("10 souvenirs : « dix »",
        "dix" in medals.evalue(etat(jours=jours(10))), True)
verifie("99 souvenirs : pas encore « cent »",
        "cent" in medals.evalue(etat(jours=jours(99))), False)
verifie("100 souvenirs : « cent »",
        "cent" in medals.evalue(etat(jours=jours(100))), True)
verifie("100 souvenirs : « dix » et « cinquante » acquises aussi",
        {"dix", "cinquante"} <= medals.evalue(etat(jours=jours(100))), True)

# ── Lieux ────────────────────────────────────────────────────────────────────
verifie("4 villes : pas encore",
        "villes_5" in medals.evalue(etat(villes={"a", "b", "c", "d"})), False)
verifie("5 villes : gagnée",
        "villes_5" in medals.evalue(etat(villes={"a", "b", "c", "d", "e"})), True)
verifie("un seul pays : pas de médaille",
        "pays_2" in medals.evalue(etat(pays={"FR"})), False)
verifie("deux pays : gagnée",
        "pays_2" in medals.evalue(etat(pays={"FR", "DE"})), True)

# ── Heures (parisiennes) ─────────────────────────────────────────────────────
verifie("07:00 pile n'est plus « avant le jour »",
        "leve_tot" in medals.evalue(etat(heures=[7])), False)
verifie("06:59 compte",
        "leve_tot" in medals.evalue(etat(heures=[6])), True)
verifie("22 h n'est pas « après la nuit »",
        "couche_tard" in medals.evalue(etat(heures=[22])), False)
verifie("23 h compte",
        "couche_tard" in medals.evalue(etat(heures=[23])), True)
verifie("heure inconnue ne compte pas",
        "couche_tard" in medals.evalue(etat(heures=[None])), False)

# ── Couple ───────────────────────────────────────────────────────────────────
verifie("un jour côte à côte : gagnée",
        "cote_a_cote" in medals.evalue(etat(cote_a_cote={"2026-01-01"})), True)
verifie("9 jours côte à côte : pas encore les dix",
        "cote_a_cote_10" in medals.evalue(etat(cote_a_cote=jours(9))), False)
verifie("10 jours côte à côte : gagnée",
        "cote_a_cote_10" in medals.evalue(etat(cote_a_cote=jours(10))), True)

# ── Séries consécutives ──────────────────────────────────────────────────────
verifie("série vide", medals.plus_longue_serie(set()), 0)
verifie("un jour seul", medals.plus_longue_serie({"2026-01-01"}), 1)
verifie("6 jours d'affilée : pas la semaine",
        "semaine" in medals.evalue(etat(jours_communs=jours(6))), False)
verifie("7 jours d'affilée : la semaine",
        "semaine" in medals.evalue(etat(jours_communs=jours(7))), True)
verifie("7 jours mais troués : pas la semaine",
        "semaine" in medals.evalue(etat(jours_communs={
            "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-05",
            "2026-01-06", "2026-01-07", "2026-01-08"})), False)
verifie("série à cheval sur deux mois",
        medals.plus_longue_serie({"2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"}), 4)
verifie("série à cheval sur deux années",
        medals.plus_longue_serie({"2025-12-31", "2026-01-01"}), 2)
verifie("29 jours : pas le mois",
        "mois" in medals.evalue(etat(jours_communs=jours(29))), False)
verifie("30 jours : le mois",
        "mois" in medals.evalue(etat(jours_communs=jours(30))), True)

# ── Distance (jamais affichée, seulement décidée) ────────────────────────────
verifie("même point : 0 m", round(medals.distance_m(48.85, 2.35, 48.85, 2.35)), 0)
# Un degré de latitude vaut ~111 320 m : on encadre le seuil au mètre près.
d_98 = medals.distance_m(48.8500, 2.3500, 48.85 + 0.00088, 2.3500)
d_102 = medals.distance_m(48.8500, 2.3500, 48.85 + 0.00092, 2.3500)
verifie("98 m : dans le seuil", d_98 <= medals.RAYON_COTE_A_COTE_M, True)
verifie("102 m : hors seuil", d_102 <= medals.RAYON_COTE_A_COTE_M, False)
verifie("500 m : hors seuil",
        medals.distance_m(48.8500, 2.3500, 48.8545, 2.3500) <= medals.RAYON_COTE_A_COTE_M,
        False)
verifie("position manquante : jamais côte à côte",
        medals.distance_m(None, 2.35, 48.85, 2.35) == float("inf"), True)

# ── Avancement affiché ───────────────────────────────────────────────────────
av = medals.avancement(etat(jours=jours(7)))
verifie("avancement vers « dix » : 7", av["dix"], 7)
verifie("avancement plafonné à la cible", medals.avancement(etat(jours=jours(80)))["dix"], 10)

# ── Catalogue ────────────────────────────────────────────────────────────────
verifie("codes uniques", len(medals.PAR_CODE), len(medals.CATALOGUE))
verifie("deux familles seulement",
        {m.famille for m in medals.CATALOGUE}, {medals.SOLO, medals.COUPLE})

print(f"{'CAS':<52}{'ATTENDU':>10}{'OBTENU':>10}")
print("-" * 76)
ok = True
for label, attendu, obtenu, bon in cas:
    if not bon:
        ok = False
    print(f"{label:<52}{str(attendu)[:10]:>10}{str(obtenu)[:10]:>10}  {'OK' if bon else 'ÉCHEC'}")
print("-" * 76)
sys.exit(0 if ok else 1)
