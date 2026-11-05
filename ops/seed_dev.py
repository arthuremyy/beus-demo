"""Souvenirs de test pour l'instance de DEV — jamais la prod.

Lancé par `ops/dev.sh --seed|--reset` dans le conteneur beus-dev. Ne fait rien
si la base contient déjà des souvenirs. Photos : aplats de couleur générés.
"""
import io, json, os, sys, urllib.request
from datetime import date, timedelta

sys.path.insert(0, "/app")
if os.getenv("BEUS_ENV") != "dev":
    sys.exit("refusé : ce script ne tourne que sur l'instance de dev (BEUS_ENV=dev)")

import db, security                      # noqa: E402
from PIL import Image, ImageDraw          # noqa: E402
from services import jour                 # noqa: E402

BASE = "http://127.0.0.1:8600/api/beus"
with db.connect() as c:
    if c.execute("SELECT COUNT(*) FROM posts").fetchone()[0]:
        sys.exit("base de dev déjà remplie — ops/dev.sh --reset pour repartir de zéro")
    comptes = [r["id"] for r in c.execute("SELECT id FROM users ORDER BY id")]
JETON = {u: security.create_token(u, u == comptes[0]) for u in comptes}

def image(fond, rond):
    b = io.BytesIO(); im = Image.new("RGB", (900, 1200), fond)
    ImageDraw.Draw(im).ellipse((250, 400, 650, 800), fill=rond); im.save(b, "JPEG", quality=85)
    return b.getvalue()

def appel(meth, chemin, jeton, corps=None, form=None):
    h = {"Cookie": f"beusauth={jeton}"}; data = None
    if form:
        lim = "----seed"; parts = []
        for k, v in form.items():
            if isinstance(v, bytes):
                parts.append(f'--{lim}\r\nContent-Disposition: form-data; name="{k}"; filename="p.jpg"\r\n'
                             f'Content-Type: image/jpeg\r\n\r\n'.encode() + v + b"\r\n")
            else:
                parts.append(f'--{lim}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        data = b"".join(parts) + f"--{lim}--\r\n".encode()
        h["Content-Type"] = f"multipart/form-data; boundary={lim}"
    elif corps is not None:
        data = json.dumps(corps).encode(); h["Content-Type"] = "application/json"
    with urllib.request.urlopen(urllib.request.Request(BASE + chemin, data=data, headers=h, method=meth)) as r:
        return json.loads(r.read())

auj = jour.aujourdhui(); hier = (date.fromisoformat(auj) - timedelta(days=1)).isoformat()
couleurs = [((220, 80, 60), (60, 200, 90)), ((240, 200, 70), (60, 200, 220))]
ids = {}
for i, u in enumerate(comptes):
    for d, leg in ((hier, "souvenir de test d'hier"), (auj, "souvenir de test du jour")):
        f = {"primary_photo": image(*couleurs[i % 2]), "secondary_photo": image((40, 40, 50), (90, 70, 60)),
             "primary_facing": "environment", "lat": str(48.8566 + i * 0.01), "lng": str(2.3522 + i * 0.01),
             "caption": leg}
        if d != auj:
            f["day"] = d
        ids[(u, d)] = appel("POST", "/posts", JETON[u], form=f)["id"]
if len(comptes) == 2:
    a, b = comptes
    appel("POST", f"/posts/{ids[(a, auj)]}/comments", JETON[b], corps={"body": "Premier mot de test"})
    appel("POST", f"/posts/{ids[(a, auj)]}/comments", JETON[a], corps={"body": "Réponse de test"})
print(f"{len(ids)} souvenirs de test créés ({', '.join(comptes)})")
