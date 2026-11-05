"""
Validation et stockage des photos — jamais de confiance dans le Content-Type
déclaré par le client, toujours un ré-encodage JPEG côté serveur (purge l'EXIF,
y compris tout GPS embarqué : la position vit uniquement dans posts.lat/lng).

Écriture en deux temps (fichiers stagés dans /data/photos/tmp/<uuid>/ puis
os.replace() vers /data/photos/<post_id>/) pour ne jamais laisser une ligne DB
pointer sur un fichier absent si le process meurt entre les deux.
"""
import io
import os
import time
import uuid
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageFilter, ImageOps

from config import settings

PHOTOS_ROOT = Path(settings.photos_root)
MAX_PHOTO_BYTES = 15 * 1024 * 1024
JPEG_QUALITY = 85

# Bombe de décompression : un fichier de quelques Ko peut déclarer des
# dimensions énormes (ex. 30000×30000). Le contrôle de TAILLE ne l'attrape pas
# — c'est au décodage que la mémoire explose (~4 octets/pixel : 30000² ≈ 3,6 Go).
# On plafonne donc le nombre de pixels AVANT tout décodage. 40 Mpx couvrent
# large un cliché d'iPhone (48 Mpx en ProRAW, mais les JPEG livrés font 12 Mpx).
MAX_IMAGE_PIXELS = 40_000_000
# Coupe aussi le garde-fou interne de Pillow au même seuil (au lieu de ~89 Mpx) :
# ceinture et bretelles si une image passe le contrôle explicite ci-dessous.
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS

# Vignette floutée servie pour un souvenir ENCORE VERROUILLÉ.
#
# Le flou est fabriqué ICI, au serveur, et le fichier flou est le seul envoyé :
# flouter en CSS reviendrait à livrer la photo entière au navigateur, et la
# règle de déblocage tomberait avec l'inspecteur d'éléments.
#
# L'information est détruite par la réduction à 32 px, pas par le flou : même
# en agrandissant le fichier reçu, il n'y a plus rien à récupérer. Le
# réagrandissement puis le flou ne servent qu'à l'œil — à 32 px brut on verrait
# des carrés, pas une photo devinée.
BLUR_SOURCE_WIDTH = 32
BLUR_OUTPUT_WIDTH = 256
BLUR_RADIUS = 8
BLUR_QUALITY = 60


class InvalidPhoto(Exception):
    pass


def _validate_and_reencode(raw: bytes) -> bytes:
    if not raw or len(raw) > MAX_PHOTO_BYTES:
        raise InvalidPhoto("Photo absente ou trop volumineuse")
    try:
        probe = Image.open(io.BytesIO(raw))
        # Les dimensions sont lues dans l'en-tête SANS décoder les pixels : on
        # refuse une bombe de décompression avant qu'elle ne coûte de la mémoire.
        largeur, hauteur = probe.size
        if largeur * hauteur > MAX_IMAGE_PIXELS:
            raise InvalidPhoto("Image trop grande (dimensions)")
        probe.verify()  # invalide l'objet pour tout usage ultérieur -> réouverture
        img = Image.open(io.BytesIO(raw))
    except InvalidPhoto:
        raise
    except Exception:
        raise InvalidPhoto("Fichier image invalide")
    img = ImageOps.exif_transpose(img)  # applique la rotation EXIF avant de la purger
    img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def _blur(jpeg: bytes) -> bytes:
    """Dérive la vignette floutée d'une photo DÉJÀ validée et ré-encodée."""
    img = Image.open(io.BytesIO(jpeg))
    w, h = img.size
    petite = img.resize(
        (BLUR_SOURCE_WIDTH, max(1, round(h * BLUR_SOURCE_WIDTH / w))), Image.BICUBIC)
    w2, h2 = petite.size
    grande = petite.resize(
        (BLUR_OUTPUT_WIDTH, max(1, round(h2 * BLUR_OUTPUT_WIDTH / w2))), Image.BICUBIC)
    out = io.BytesIO()
    grande.filter(ImageFilter.GaussianBlur(BLUR_RADIUS)).save(
        out, format="JPEG", quality=BLUR_QUALITY, optimize=True)
    return out.getvalue()


async def stage_upload(upload: UploadFile) -> bytes:
    raw = await upload.read()
    return _validate_and_reencode(raw)


def new_tmp_dir() -> Path:
    d = PHOTOS_ROOT / "tmp" / uuid.uuid4().hex
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_staged(tmp_dir: Path, primary: bytes, secondary: bytes):
    """La vignette floutée est dérivée ici, dans la même passe que les photos :
    un souvenir ne doit jamais exister sans elle, sinon il serait invisible dans
    le flux de l'autre compte tant qu'il est verrouillé."""
    (tmp_dir / "primary.jpg").write_bytes(primary)
    (tmp_dir / "secondary.jpg").write_bytes(secondary)
    (tmp_dir / "blur.jpg").write_bytes(_blur(primary))


PHOTO_FILES = ("primary.jpg", "secondary.jpg", "blur.jpg")


def jette_staged(tmp_dir: Path):
    """Abandonne des fichiers stagés qui ne deviendront jamais un souvenir
    (jour déjà rempli, par exemple). Sans ça, chaque refus laisserait trois
    fichiers derrière lui jusqu'au balayage horaire."""
    try:
        for f in tmp_dir.iterdir():
            f.unlink(missing_ok=True)
        tmp_dir.rmdir()
    except OSError:
        pass


def commit_post_photos(tmp_dir: Path, post_id: int) -> tuple[str, str, str]:
    """Déplace les fichiers stagés vers leur emplacement définitif. Retourne les
    chemins relatifs à PHOTOS_ROOT, tels que stockés en DB."""
    final_dir = PHOTOS_ROOT / str(post_id)
    final_dir.mkdir(parents=True, exist_ok=True)
    for nom in PHOTO_FILES:
        os.replace(tmp_dir / nom, final_dir / nom)
    try:
        tmp_dir.rmdir()
    except OSError:
        pass
    return tuple(f"{post_id}/{nom}" for nom in PHOTO_FILES)


def resolve_photo_path(relative: str) -> Path | None:
    """Chemins toujours générés côté serveur (jamais fournis par l'appelant) —
    garde-fou anti-traversal en ceinture-bretelles."""
    root = PHOTOS_ROOT.resolve()
    p = (PHOTOS_ROOT / relative).resolve()
    if p != root and root not in p.parents:
        return None
    return p if p.is_file() else None


def delete_post_photos(*paths: str | None):
    """Supprime toutes les dérivées d'un souvenir — photos ET vignette floutée.
    Oublier le flou laisserait un aperçu du souvenir supprimé sur le disque."""
    for rel in paths:
        if not rel:
            continue
        p = resolve_photo_path(rel)
        if p:
            p.unlink(missing_ok=True)


def avatar_url(user_id: str, avatar_path: str | None) -> str | None:
    """L'adresse de l'avatar, versionnée par la date du fichier : l'avatar est
    servi avec un cache d'une heure, et sans version l'autre téléphone
    gardait l'ancienne photo après un changement."""
    if not avatar_path:
        return None
    chemin = resolve_photo_path(avatar_path)
    try:
        v = int(chemin.stat().st_mtime) if chemin else 0
    except OSError:
        v = 0
    return f"/api/beus/users/{user_id}/avatar?v={v}"


def save_avatar(user_id: str, raw: bytes) -> str:
    data = _validate_and_reencode(raw)
    avatars_dir = PHOTOS_ROOT / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    (avatars_dir / f"{user_id}.jpg").write_bytes(data)
    return f"avatars/{user_id}.jpg"


def delete_avatar(avatar_path: str | None):
    """Efface le fichier de l'avatar. Silencieux s'il n'existe plus."""
    chemin = resolve_photo_path(avatar_path) if avatar_path else None
    if chemin:
        chemin.unlink(missing_ok=True)


def sweep_stale_tmp(max_age_seconds: int = 3600):
    """Balaie au démarrage les dossiers tmp orphelins d'un crash avant commit —
    même esprit de nettoyage idempotent que le reste du repo."""
    tmp_root = PHOTOS_ROOT / "tmp"
    if not tmp_root.is_dir():
        return
    now = time.time()
    for d in tmp_root.iterdir():
        try:
            if d.is_dir() and (now - d.stat().st_mtime) > max_age_seconds:
                for f in d.iterdir():
                    f.unlink(missing_ok=True)
                d.rmdir()
        except OSError:
            pass
