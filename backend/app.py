"""
BeUs — journal photo à deux (Alex & Sam), accessible publiquement
sur beus.example.com (Cloudflare Tunnel — Sam n'est pas sur le Tailscale).

Service autonome : sert son propre frontend (modèle job-radar/stockage). Auth
par PIN + JWT avec identité RÉELLE par utilisateur (voir security.py) — un
écart assumé par rapport au pattern `sfauth` partagé (un seul admin) du reste
de la stack, avec secret dédié (BEUS_JWT_SECRET) et cookie au nom distinct
(`beusauth`).
"""
import asyncio
import os
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import db
import security
from config import settings
from routers import auth, comments, posts, push, stats, users
from services import labels, rappels, storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("beus")

if not settings.jwt_secret:
    raise RuntimeError("BEUS_JWT_SECRET non défini dans l'environnement")

FRONTEND = Path(__file__).parent / "frontend"

# Sondes + écran de connexion : joignables sans JWT.
PUBLIC_PATHS = {"/api/beus/health", "/api/beus/auth/login", "/api/beus/auth/accounts"}
# L'avatar aussi : l'écran de connexion montre les deux visages AVANT toute
# session, et /auth/accounts est déjà public. Un avatar n'est pas un souvenir —
# il ne relève d'aucune règle de déblocage. Motif volontairement étroit : rien
# d'autre sous /users/ ne doit passer sans session.
# ⚠ LECTURE seulement, et jamais « me » : l'ancien motif laissait passer
# POST /users/me/avatar sans session — le middleware ne posait alors pas
# request.state.user_id et l'envoi d'une photo de profil plantait (500).
PUBLIC_PATTERNS = (re.compile(r"^/api/beus/users/(?!me/)[A-Za-z0-9_-]{1,32}/avatar$"),)
PUBLIC_METHODS_PATTERNS = {"GET", "HEAD"}


def _est_public(path: str, method: str = "GET") -> bool:
    if path in PUBLIC_PATHS:
        return True
    return method in PUBLIC_METHODS_PATTERNS and any(p.match(path) for p in PUBLIC_PATTERNS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("BeUs starting...")
    db.init()
    storage.sweep_stale_tmp()
    # Rattrapage des noms de lieux manquants, en fond : plafonné et jamais en
    # boucle (politique Nominatim). Ne retarde pas le démarrage.
    asyncio.create_task(asyncio.to_thread(labels.backfill))
    # Rappels de 15 h et 21 h (services/rappels.py) — une passe par minute.
    # BEUS_RAPPELS=0 les coupe : l'instance de dev ne doit relancer personne.
    tache_rappels = None
    if os.getenv("BEUS_RAPPELS", "1") != "0":
        tache_rappels = asyncio.create_task(rappels.boucle())
    else:
        logger.info("rappels désactivés (BEUS_RAPPELS=0)")
    logger.info("BeUs ready.")
    yield
    if tache_rappels:
        tache_rappels.cancel()
    logger.info("BeUs stopped.")


# `openapi_url=None` ferme AUSSI /openapi.json : sinon FastAPI publie tout le
# schéma de l'API (chemins, corps attendus, descriptions) sans authentification,
# alors que /docs et /redoc sont déjà coupés. BeUs est exposé publiquement — on
# ne donne pas la carte de l'API à un inconnu.
app = FastAPI(title="BeUs", version="1.0.0", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)


# En-têtes de sécurité — BeUs ne passe PAS par le nginx qui protège le reste de
# la stack (cloudflared → conteneur, direct). Ces en-têtes doivent donc être
# posés par l'appli elle-même, sinon ils n'existent nulle part.
#
# La CSP garde `script-src` serré (les seules origines de code réellement
# utilisées : l'app, plus MapLibre/supercluster en CDN) — c'est la vraie
# défense en profondeur contre le XSS. Le reste (images de tuiles, polices)
# est plus large pour ne pas casser la carte. `frame-ancestors 'none'` bloque
# le détournement de clic (l'app ne s'embarque dans aucune iframe).
_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; "
    # MapLibre télécharge son worker (maplibre-gl-worker.mjs) depuis unpkg : ce
    # fetch relève de worker-src, pas de script-src. Sans unpkg ici, la carte
    # ne s'initialise jamais (échec réseau « csp », muet côté console).
    "worker-src 'self' blob: https://unpkg.com; "
    # unpkg sert AUSSI le CSS de MapLibre ; fonts.googleapis les polices.
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com; "
    "img-src 'self' data: blob: https:; "
    # MapLibre récupère les tuiles satellite/relief par fetch (pas en <img>) :
    # ces deux origines DOIVENT être dans connect-src, sinon la carte est vide.
    "connect-src 'self' https://unpkg.com https://cdn.jsdelivr.net "
    "https://server.arcgisonline.com https://s3.amazonaws.com; "
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
)
_SECURITY_HEADERS = {
    "Content-Security-Policy": _CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    # Le navigateur autorise la caméra et la géoloc à l'app elle-même (capture)
    # mais à personne d'autre : rien n'est délégué à un tiers embarqué.
    "Permissions-Policy": "camera=(self), geolocation=(self), microphone=()",
}


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # On ne renvoie PAS `exc.errors()` : il recopie les valeurs reçues (`input`)
    # dans la réponse, ce qui reflète l'entrée d'un attaquant et détaille le
    # schéma interne. Le champ fautif suffit au client légitime.
    champs = [".".join(str(p) for p in e.get("loc", [])) for e in exc.errors()[:5]]
    return JSONResponse(status_code=422,
                         content={"detail": "Données invalides", "champs": champs})


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """JWT requis sur /api/* (cookie beusauth ou Bearer). Le payload porte une
    identité réelle (sub=alex|sam, adm=bool) posée sur request.state pour que
    les routers puissent distinguer les deux comptes."""
    path = request.url.path
    if not path.startswith("/api/") or _est_public(path, request.method) or request.method == "OPTIONS":
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else request.cookies.get(security.COOKIE_NAME)

    if token:
        payload = security.decode_token(token)
        if payload:
            request.state.user_id = payload.get("sub")
            request.state.is_admin = bool(payload.get("adm"))
            return await call_next(request)

    return JSONResponse(status_code=401, content={"detail": "Non authentifié"})


@app.middleware("http")
async def no_edge_cache(request: Request, call_next):
    """Cloudflare (proxied) met en cache les extensions statiques (css/js/json)
    à l'edge INDÉPENDAMMENT des en-têtes d'origine, TTL par défaut ~4h — piège
    déjà rencontré sur l'ancien site (photos servies périmées après un
    changement). App activement modifiée : mieux vaut resservir à chaque fois
    (ETag déjà posé par StaticFiles pour les 304) que risquer un déploiement
    qui ne se voit pas avant des heures."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# Défini EN DERNIER pour être le middleware le plus externe (Starlette empile
# du dernier au premier) : ainsi les en-têtes de sécurité couvrent TOUTES les
# réponses, y compris les 401/404/422 renvoyées avant les autres middlewares.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for k, v in _SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


for r in (auth.router, posts.router, posts.photos_router, posts.jours_router, posts.echo_router,
          posts.lieu_router,
          stats.router, users.router, comments.router, push.router):
    app.include_router(r)


@app.get("/api/beus/health")
async def health():
    """Healthcheck sans auth (HEALTHCHECK Docker)."""
    return {"status": "ok", "service": "beus", "version": "1.0.0"}


if FRONTEND.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")
    app.mount("/icons", StaticFiles(directory=FRONTEND / "icons"), name="icons")

    # Le service worker DOIT être servi depuis la racine : sa portée ne peut pas
    # dépasser son propre chemin, et il doit couvrir toute l'app (notifications).
    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(FRONTEND / "sw.js", media_type="text/javascript")

    @app.get("/manifest.json")
    async def manifest():
        return FileResponse(FRONTEND / "manifest.json")

    @app.get("/")
    async def index():
        return FileResponse(FRONTEND / "index.html")
else:
    logger.warning("Dossier frontend absent : %s", FRONTEND)
