"""
Parcours backend de bout en bout : un souvenir par jour, rattrapage, souvenir
verrouillé visible MAIS étanche, déblocage par le jour, médailles, profil.

⚠ Se lance contre une instance JETABLE, jamais contre la production : il publie
de vrais souvenirs. Monter le backend et une base neuve dans un conteneur à
part, puis :

    docker run -d --name beus-essai \
      -v .../beus/backend:/app/backend:ro -v <tmp>:/tmpdata \
      -e DB_PATH=/tmpdata/t.db -e PHOTOS_ROOT=/tmpdata/photos -e TZ=Europe/Paris \
      -e BEUS_JWT_SECRET=essai -e ALEX_PIN_HASH=x -e SAM_PIN_HASH=x \
      -w /app/backend docker_beus python3 -m uvicorn app:app --host 0.0.0.0 --port 8600
    docker cp tests/parcours.py beus-essai:/tmp/
    docker exec -w /app/backend beus-essai python3 -c \
      "import sys;sys.path.insert(0,'/app/backend');exec(open('/tmp/parcours.py').read())"

Les hash de PIN peuvent être n'importe quoi : le test forge ses jetons avec
security.create_token(), il ne passe pas par /auth/login.
"""
import io, json, urllib.request, urllib.error
import security
from PIL import Image

BASE = "http://127.0.0.1:8600/api/beus"
A = security.create_token("alex", True)
L = security.create_token("sam", False)

def png(c):
    b = io.BytesIO(); Image.new("RGB", (400, 500), c).save(b, "PNG"); return b.getvalue()

def appel(method, path, token, corps=None, form=None):
    if form is not None:
        limite = "----x"
        parts = []
        for k, v in form.items():
            if isinstance(v, bytes):
                parts.append(f'--{limite}\r\nContent-Disposition: form-data; name="{k}"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n'.encode() + v + b"\r\n")
            else:
                parts.append(f'--{limite}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        data = b"".join(parts) + f"--{limite}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={limite}"}
    elif corps is not None:
        data = json.dumps(corps).encode(); headers = {"Content-Type": "application/json"}
    else:
        data = None; headers = {}
    headers["Cookie"] = f"beusauth={token}"
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            brut = r.read()
            try: return r.status, json.loads(brut)
            except Exception: return r.status, brut
    except urllib.error.HTTPError as e:
        brut = e.read()
        try: return e.code, json.loads(brut)
        except Exception: return e.code, brut

def poste(token, jour, lat, lng, legende):
    f = {"primary_photo": png((200, 60, 90)), "secondary_photo": png((30, 30, 40)),
         "primary_facing": "environment", "lat": str(lat), "lng": str(lng),
         "caption": legende}
    if jour: f["day"] = jour
    return appel("POST", "/posts", token, form=f)

ok = True
def dit(label, obtenu, attendu):
    global ok
    bon = obtenu == attendu
    if not bon: ok = False
    print(f"{'OK   ' if bon else 'ÉCHEC'} {label:<52} {obtenu!r:>20}" + ("" if bon else f"  attendu {attendu!r}"))

AUJ = __import__("services.jour", fromlist=["x"]).aujourdhui()
from datetime import date, timedelta
HIER = (date.fromisoformat(AUJ) - timedelta(days=1)).isoformat()
VIEUX = (date.fromisoformat(AUJ) - timedelta(days=9)).isoformat()

# 1. un par jour
s, r = poste(A, None, 48.8566, 2.3522, "alex aujourd'hui"); dit("alex publie aujourd'hui", s, 200)
pid_a = r.get("id")
s, r = poste(A, None, 48.8566, 2.3522, "doublon"); dit("2e du jour refusé (409)", s, 409)
s, r = poste(A, VIEUX, 45.7, 4.8, "trop vieux"); dit("hors fenêtre refusé (422)", s, 422)
s, r = poste(A, HIER, 48.8566, 2.3522, "rattrapage"); dit("rattrapage J-1 accepté", s, 200)
dit("le rattrapage est marqué", r.get("is_catchup"), True)

# 2. sam voit le verrouillé, sans le contenu
s, flux = appel("POST", "/posts/feed", L, corps={"limit": 20})
dit("le flux de Sam montre les 2 souvenirs", len(flux["posts"]), 2)
verrou = flux["posts"][0]
dit("il est verrouillé", verrou["unlocked"], False)
dit("il a un jour", bool(verrou["day"]), True)
dit("il a une vignette floutée", bool(verrou["blur_photo_url"]), True)
dit("AUCUNE légende ne sort", "caption" in verrou, False)
dit("AUCUNE photo pleine ne sort", "primary_photo_url" in verrou, False)
s, _ = appel("GET", f"/photos/{pid_a}/primary", L); dit("photo pleine refusée à Sam", s, 403)
s, _ = appel("GET", f"/photos/{pid_a}/blur", L); dit("vignette floutée servie à Sam", s, 200)
s, _ = appel("GET", f"/posts/{pid_a}", L); dit("détail refusé à Sam", s, 403)

# 3. déblocage par le jour
s, r = poste(L, None, 48.8567, 2.3523, "sam aujourd'hui"); dit("sam remplit aujourd'hui", s, 200)
s, flux = appel("POST", "/posts/feed", L, corps={"limit": 20})
par_jour = {p["day"]: p for p in flux["posts"] if p["author_id"] == "alex"}
dit("aujourd'hui d'alex est ouvert", par_jour[AUJ]["unlocked"], True)
dit("hier d'alex reste fermé", par_jour[HIER]["unlocked"], False)
s, _ = appel("GET", f"/photos/{pid_a}/primary", L); dit("photo pleine servie après déblocage", s, 200)

# 4. les jours
s, j = appel("GET", "/jours", L)
dit("la fenêtre fait 2 jours (J et J-1)", len(j["jours"]), 2)
dit("aujourd'hui est rempli pour sam", j["aujourdhui_rempli"], True)
dit("hier est à combler pour sam", HIER in j["a_combler"], True)

# 5. médailles
s, prof = appel("GET", "/users/me", A)
codes = {m["code"] for m in prof["medailles"]["solo"] if m["obtenue"]}
dit("alex a « premier »", "premier" in codes, True)
couple = {m["code"]: m["obtenue"] for m in prof["medailles"]["couple"]}
dit("« côte à côte » gagnée (même lieu, même jour)", couple["cote_a_cote"], True)
dit("« à la même minute » gagnée", couple["synchro"], True)
dit("« dix fois côte à côte » pas encore", couple["cote_a_cote_10"], False)
dit("compteur de souvenirs d'alex", prof["compteurs"]["souvenirs"], 2)
dit("jours à deux", prof["compteurs"]["jours_a_deux"], 1)

# 6. profil éditable
s, r = appel("PATCH", "/users/me", A, corps={"bio": "  deux lignes  "})
dit("bio enregistrée", r["bio"], "deux lignes")
s, r = appel("PATCH", "/users/me", A, corps={"display_name": "   "})
dit("nom vide refusé", s, 422)

# 7. avatar public
req = urllib.request.Request(f"{BASE}/users/alex/avatar")
try:
    urllib.request.urlopen(req); code = 200
except urllib.error.HTTPError as e: code = e.code
dit("avatar sans session : 404 (pas 401)", code, 404)
req = urllib.request.Request(f"{BASE}/users/alex/profil")
try:
    urllib.request.urlopen(req); code = 200
except urllib.error.HTTPError as e: code = e.code
dit("profil sans session : 401", code, 401)

# 8. commentaires — le fil suit le déblocage
pid_hier = [p for p in flux["posts"] if p["author_id"] == "alex" and p["day"] == HIER][0]["id"]
s, _ = appel("GET", f"/posts/{pid_hier}/comments", L); dit("fil d'un verrouillé : lecture refusée", s, 403)
s, _ = appel("POST", f"/posts/{pid_hier}/comments", L, corps={"body": "coucou"})
dit("fil d'un verrouillé : écriture refusée", s, 403)
verrou_hier = [p for p in flux["posts"] if p["id"] == pid_hier][0]
dit("pas de comment_count sur un verrouillé", "comment_count" in verrou_hier, False)
s, r = appel("POST", f"/posts/{pid_a}/comments", L, corps={"body": "  <b>trop</b> beau  "})
dit("sam commente le souvenir ouvert (201)", s, 201)
cid_sam = r.get("id")
dit("le texte est gardé tel quel (échappé au rendu)", r.get("body"), "<b>trop</b> beau")
s, _ = appel("POST", f"/posts/{pid_a}/comments", L, corps={"body": "   "})
dit("commentaire vide refusé", s, 422)
s, _ = appel("POST", f"/posts/{pid_a}/comments", L, corps={"body": "x" * 501})
dit("commentaire trop long refusé", s, 422)
s, n = appel("GET", "/nouveautes", A)
dit("alex a 1 commentaire non lu", n["commentaires_non_lus"], 1)
dit("… sur le bon souvenir", n["par_post"].get(str(pid_a)), 1)
s, f = appel("GET", f"/posts/{pid_a}/comments", A)
dit("alex lit le fil", [c["author_id"] for c in f["comments"]], ["sam"])
s, n = appel("GET", "/nouveautes", A)
dit("lu : plus de non lu", n["commentaires_non_lus"], 0)
s, r = appel("POST", f"/posts/{pid_a}/comments", A, corps={"body": "merci"})
dit("l'auteur répond sous son souvenir", s, 201)
s, n = appel("GET", "/nouveautes", L)
dit("sam voit la réponse en non lu", n["commentaires_non_lus"], 1)
s, _ = appel("DELETE", f"/comments/{cid_sam}", A)
dit("alex ne supprime pas le commentaire de sam", s, 403)
s, _ = appel("DELETE", f"/comments/{cid_sam}", L)
dit("sam supprime le sien", s, 200)
s, p = appel("GET", f"/posts/{pid_a}", A)
dit("comment_count suit la suppression", p["comment_count"], 1)

# 9. légende : l'auteur la corrige, personne d'autre ; suppression = admin
s, p = appel("PATCH", f"/posts/{pid_a}", A, corps={"caption": " corrigée "})
dit("l'auteur corrige sa légende", p.get("caption"), "corrigée")
s, _ = appel("PATCH", f"/posts/{pid_a}", L, corps={"caption": "pirate"})
dit("sam ne corrige pas la légende d'alex", s, 403)
pid_sam = [p for p in appel("POST", "/posts/feed", L, corps={"limit": 20})[1]["posts"]
           if p["author_id"] == "sam"][0]["id"]
s, _ = appel("DELETE", f"/posts/{pid_sam}", L)
dit("sam ne supprime pas (même le sien)", s, 403)

# 10. nouveautés : souvenirs de l'autre pas encore vus
s, n = appel("GET", "/nouveautes", A)
dit("alex a 1 nouveau souvenir de sam", n["nouveaux_souvenirs"], 1)
appel("POST", "/nouveautes/journal-vu", A)
s, n = appel("GET", "/nouveautes", A)
dit("vu : plus de nouveau souvenir", n["nouveaux_souvenirs"], 0)

# 11. tombstone : le fil part avec le souvenir
s, _ = appel("DELETE", f"/posts/{pid_a}", A); dit("admin supprime", s, 200)
s, _ = appel("GET", f"/posts/{pid_a}/comments", A); dit("fil d'un supprimé : 404", s, 404)
s, n = appel("GET", "/nouveautes", L)
dit("plus de non lu sur un supprimé", n["commentaires_non_lus"], 0)

# 12. push : sans clés, désactivé proprement
s, c = appel("GET", "/push/cle", A)
dit("push/cle répond", s, 200)
s, _ = appel("POST", "/push/abonnement", A, corps={"endpoint": "http://x.invalid/abc", "keys": {"p256dh": "a", "auth": "b"}})
dit("endpoint non https refusé", s, 422)
s, _ = appel("POST", "/push/abonnement", A, corps={"endpoint": "https://web.push.apple.com/test-auto", "keys": {"p256dh": "a", "auth": "b"}})
dit("abonnement enregistré", s, 200)
s, e = appel("GET", "/push/etat", A); dit("1 appareil", e["appareils"], 1)
appel("POST", "/push/desabonnement", A, corps={"endpoint": "https://web.push.apple.com/test-auto"})
s, e = appel("GET", "/push/etat", A); dit("désabonné", e["appareils"], 0)

# 13. série à deux — alex republie aujourd'hui (son souvenir a été supprimé
# à l'étape 11) : les deux ont rempli aujourd'hui, hier seul alex
s, _ = poste(A, None, 48.8566, 2.3522, "republié"); dit("alex republie aujourd'hui", s, 200)
s, st = appel("GET", "/stats", L); dit("série à deux = 1", st.get("serie"), 1)
s, prof = appel("GET", "/users/me", L); dit("série dans le profil", prof["compteurs"].get("serie"), 1)

# 14. écho : il y a un mois, jour pour jour — seulement ce qui est ouvert
from routers.posts import _decale
import db as _db
MOIS = _decale(AUJ, 1)
if MOIS:
    with _db.connect() as c:
        c.execute("INSERT INTO posts (author_id, seq, day, caption, lat, lng) "
                  "VALUES ('alex', 99, ?, 'il y a un mois', 45.7, 4.8)", (MOIS,))
        c.commit()
    s, e = appel("GET", "/souvenirs/echo", A)
    dit("alex retrouve son souvenir d'il y a un mois", [x["quand"] for x in e["souvenirs"]], ["mois"])
    s, e = appel("GET", "/souvenirs/echo", L)
    dit("sam ne voit pas un souvenir qu'elle n'a pas ouvert", e["souvenirs"], [])

# 15. fête des médailles : nouvelles → fêtées → plus rien
s, n = appel("GET", "/users/me/medailles/nouvelles", A)
codes = [m["code"] for m in n["medailles"]]
dit("alex a des médailles à fêter", len(codes) > 0, True)
appel("POST", "/users/me/medailles/fetees", A, corps={"codes": codes})
s, n = appel("GET", "/users/me/medailles/nouvelles", A)
dit("fêtées : plus rien à fêter", n["medailles"], [])

# 16. rappels : un compte qui n'a pas publié, une fois par créneau
from datetime import datetime as _dt
from services import rappels, jour as _jour
DEMAIN = date.fromisoformat(AUJ) + timedelta(days=1)
quinze = _dt(DEMAIN.year, DEMAIN.month, DEMAIN.day, 15, 0, tzinfo=_jour.zone())
dit("15 h demain : les deux relancés", sorted(rappels.passe(quinze)), [("alex", "premier"), ("sam", "premier")])
dit("rejoué : aucun doublon", rappels.passe(quinze), [])
auj15 = _dt.now(_jour.zone()).replace(hour=15, minute=5)
dit("aujourd'hui (tous deux ont publié) : rien", rappels.passe(auj15), [])

print("\n" + ("✅ parcours complet" if ok else "❌ des cas échouent"))
raise SystemExit(0 if ok else 1)
