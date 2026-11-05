import sys, os
sys.path.insert(0, os.getcwd())
os.environ.setdefault("BEUS_JWT_SECRET", "x")
from services.geocode import _shorten, MAX_LEN

# Les deux comptes vivent en France et en Allemagne : ce sont ces découpages
# administratifs-là que le nettoyage doit savoir retirer.
cas = [
    ("quartier + ville (DE)",
     {"suburb": "Ehrenfeld", "city": "Köln", "country": "Allemagne"},
     "Ehrenfeld, Köln"),
    ("« Stadtbezirk 3 » ne situe rien : la ville prend le relais",
     {"city_district": "Stadtbezirk 3", "city": "Köln", "country": "Allemagne"},
     "Köln, Allemagne"),
    ("« Kreisfreie Stadt » retiré",
     {"city": "Kreisfreie Stadt Köln", "country": "Allemagne"}, "Köln, Allemagne"),
    ("« Gemeinde » retiré",
     {"suburb": "Altstadt", "city": "Gemeinde Heidelberg", "country": "Allemagne"},
     "Altstadt, Heidelberg"),
    ("arrondissement retiré (FR)",
     {"city": "Paris 4e Arrondissement", "country": "France"}, "Paris, France"),
    ("quartier + ville (FR)",
     {"neighbourhood": "Montmartre", "city": "Paris", "country": "France"},
     "Montmartre, Paris"),
    ("quartier à rallonge : la VILLE survit",
     {"neighbourhood": "Capitole / Arnaud Bernard / Carmes", "city": "Toulouse",
      "country": "France"}, "Capitole, Toulouse"),
    ("ville seule",
     {"city": "Strasbourg", "country": "France"}, "Strasbourg, France"),
    ("rien d'exploitable", {"road": "Rue Machin"}, None),
]

fails = 0
print(f"{'CAS':<52}{'ATTENDU':<24}OBTENU")
print("-" * 100)
for label, addr, attendu in cas:
    got = _shorten(addr)
    ok = got == attendu
    if not ok:
        fails += 1
    print(f"{label:<52}{str(attendu):<24}{got}  {'OK' if ok else 'ÉCHEC'}")

orphelin = _shorten({"neighbourhood": "A" * 60, "city": "Berlin", "country": "Allemagne"})
ok_ville = orphelin is not None and orphelin.endswith("Berlin")
print(f"{'quartier énorme : ville conservée':<52}{'…, Berlin':<24}{orphelin}  {'OK' if ok_ville else 'ÉCHEC'}")
if not ok_ville:
    fails += 1

trop_long = [c for c in cas if _shorten(c[1]) and len(_shorten(c[1])) > MAX_LEN]
print(f"\nlibellés dépassant {MAX_LEN} caractères : {len(trop_long)}")
if trop_long:
    fails += 1
print("\n" + ("❌ %d échec(s)" % fails if fails else "✅ libellés de lieu corrects"))
sys.exit(1 if fails else 0)
