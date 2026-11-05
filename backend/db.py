"""
SQLite (WAL) — schéma BeUs + migrations idempotentes.

Deux utilisateurs fixes (alex, sam), amorcés à l'init depuis les hash de PIN
fournis en variables d'environnement (ALEX_PIN_HASH / SAM_PIN_HASH).

Le déblocage réciproque (services/reveal.py) repose sur `posts.day` : le jour
calendaire parisien (services/jour.py). On ouvre le souvenir de l'autre pour un
jour donné en remplissant soi-même ce jour-là.

`posts.seq` reste attribué (numéro d'ordre personnel, jamais réutilisé même
après suppression — MAX(seq), pas COUNT(*)) mais ne décide PLUS rien : il ne
sert qu'à l'affichage. Ne pas lui redonner de pouvoir.
"""
import logging
import sqlite3
from pathlib import Path

from config import settings
from services import jour as jour_svc

logger = logging.getLogger("beus.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
    id                   TEXT PRIMARY KEY,        -- 'alex' | 'sam'
    display_name         TEXT NOT NULL,
    pin_hash             TEXT NOT NULL,
    is_admin             INTEGER DEFAULT 0,
    avatar_path          TEXT,
    failed_pin_attempts  INTEGER DEFAULT 0,
    locked_until         TEXT,
    created_at           TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id             TEXT NOT NULL REFERENCES users(id),
    seq                   INTEGER NOT NULL,
    caption               TEXT,
    lat                   REAL,
    lng                   REAL,
    location_label        TEXT,
    primary_photo_path    TEXT,
    secondary_photo_path  TEXT,
    primary_facing        TEXT,                    -- 'user' | 'environment'
    captured_at           TEXT,
    created_at            TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at            TEXT,
    deleted_reason        TEXT,                     -- 'admin_delete' | 'purge'
    UNIQUE (author_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_posts_author_seq ON posts (author_id, seq);
CREATE INDEX IF NOT EXISTS idx_posts_active     ON posts (deleted_at, created_at DESC);

-- La SEULE chose dérivée des posts qu'on persiste, et pour une raison précise :
-- une médaille a une date d'obtention et ne se fête qu'une fois. La condition,
-- elle, reste calculée (services/medals.py). Une ligne ici ne s'efface jamais :
-- une médaille obtenue le reste, même si un souvenir supprimé rend la condition
-- de nouveau fausse.
CREATE TABLE IF NOT EXISTS medailles (
    user_id     TEXT NOT NULL REFERENCES users(id),
    code        TEXT NOT NULL,
    obtained_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, code)
);

-- Commentaires : un fil par souvenir. On ne lit et n'écrit le fil QUE d'un
-- souvenir ouvert (routers/comments.py applique la même garde que
-- GET /posts/{id}) — un commentaire est du contenu, il suit le déblocage.
CREATE TABLE IF NOT EXISTS commentaires (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id     INTEGER NOT NULL REFERENCES posts(id),
    author_id   TEXT NOT NULL REFERENCES users(id),
    body        TEXT NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_com_post ON commentaires (post_id, id);

-- Ce que chacun a déjà lu d'un fil : le plus grand id de commentaire vu.
-- Base de la pastille « nouveau » (GET /nouveautes).
CREATE TABLE IF NOT EXISTS lectures (
    user_id     TEXT NOT NULL REFERENCES users(id),
    post_id     INTEGER NOT NULL REFERENCES posts(id),
    dernier_lu  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, post_id)
);

-- Abonnements Web Push (un par appareil). Supprimés dès que le service de
-- push répond 404/410 : l'appareil a retiré l'app ou révoqué l'autorisation.
CREATE TABLE IF NOT EXISTS push_abonnements (
    endpoint    TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
"""

# Ajouts de colonnes — additifs et idempotents (l'échec « duplicate column » est
# avalé dans init()). Ne JAMAIS y mettre de DROP ni de modification de type.
ALTERS: list[str] = [
    # Le jour parisien, calculé à l'insertion (services/jour.py). Clé de toute
    # la mécanique : un souvenir par jour et par compte.
    "ALTER TABLE posts ADD COLUMN day TEXT",
    # 1 quand le souvenir comble un jour passé. La position, elle, reste celle
    # du moment où on publie : on ne réécrit pas le GPS, on signale le décalage.
    "ALTER TABLE posts ADD COLUMN is_catchup INTEGER DEFAULT 0",
    # Vignette floutée fabriquée au serveur : c'est elle qu'on sert pour un
    # souvenir verrouillé. Flouter en CSS enverrait la photo entière.
    "ALTER TABLE posts ADD COLUMN blur_photo_path TEXT",
    # Lieu structuré, pour les médailles (villes, pays). location_label reste
    # la version lisible ; on ne compte pas des villes sur du texte libre.
    "ALTER TABLE posts ADD COLUMN city TEXT",
    "ALTER TABLE posts ADD COLUMN country TEXT",
    # Deux lignes de présentation sur le profil. Rien d'obligatoire.
    "ALTER TABLE users ADD COLUMN bio TEXT",
    # Le plus grand id de souvenir de l'AUTRE déjà vu dans le journal : au-delà,
    # c'est « nouveau » (pastille de l'onglet journal).
    "ALTER TABLE users ADD COLUMN journal_vu_id INTEGER DEFAULT 0",
    # 1 quand la médaille a été fêtée à l'écran (assets/js/fete.js) : une
    # médaille ne se fête qu'une fois, sur le premier appareil qui la voit.
    "ALTER TABLE medailles ADD COLUMN fetee INTEGER DEFAULT 0",
]

# Index posés APRÈS les ALTERS : ils portent sur des colonnes que le SCHEMA
# initial ne connaît pas.
#
# L'unicité est PARTIELLE (WHERE deleted_at IS NULL) et ce n'est pas un détail :
# la table garde ses pierres tombales, et une contrainte classique interdirait
# de republier un jour dont le souvenir a été supprimé.
INDEXES: list[str] = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_jour_unique "
    "ON posts (author_id, day) WHERE deleted_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_posts_day ON posts (day, deleted_at)",
]


class JourDejaRempli(Exception):
    """Ce compte a déjà un souvenir vivant pour ce jour."""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def rows(cursor) -> list[dict]:
    return [dict(r) for r in cursor.fetchall()]


def get_meta(conn, key: str) -> str | None:
    r = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else None


def set_meta(conn, key: str, value: str):
    conn.execute("INSERT INTO meta (key,value) VALUES (?,?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def _seed_users(conn):
    if settings.alex_pin_hash:
        conn.execute(
            "INSERT OR IGNORE INTO users (id, display_name, pin_hash, is_admin) "
            "VALUES ('alex', 'Alex', ?, 1)", (settings.alex_pin_hash,))
    if settings.sam_pin_hash:
        conn.execute(
            "INSERT OR IGNORE INTO users (id, display_name, pin_hash, is_admin) "
            "VALUES ('sam', 'Sam', ?, 0)", (settings.sam_pin_hash,))


def _migre_jours(conn):
    """Renseigne posts.day pour les lignes antérieures à la colonne, une seule
    fois. Les pierres tombales sont traitées comme les autres : l'index unique
    étant partiel, leur jour ne bloque personne, et elles restent lisibles."""
    if get_meta(conn, "schema_jour") == "1":
        return
    restantes = rows(conn.execute(
        "SELECT id, created_at FROM posts WHERE day IS NULL"))
    for r in restantes:
        conn.execute("UPDATE posts SET day=? WHERE id=?",
                      (jour_svc.jour_de_created_at(r["created_at"]), r["id"]))
    set_meta(conn, "schema_jour", "1")
    if restantes:
        logger.info("migration jour : %d souvenir(s) datés", len(restantes))


def _pose_index(conn):
    """L'unicité par jour est posée après coup. Si des doublons vivants
    existaient déjà, l'index refuserait de se créer : on le dit FORT plutôt que
    de laisser l'app tourner en croyant la règle garantie par la base."""
    for stmt in INDEXES:
        try:
            conn.execute(stmt)
        except sqlite3.IntegrityError:
            doublons = rows(conn.execute(
                "SELECT author_id, day, COUNT(*) AS n FROM posts "
                "WHERE deleted_at IS NULL AND day IS NOT NULL "
                "GROUP BY author_id, day HAVING n > 1"))
            set_meta(conn, "index_jour_unique", "absent")
            logger.error(
                "index unique par jour NON posé — doublons vivants : %s. "
                "La règle « un souvenir par jour » n'est plus garantie par la "
                "base, seulement par l'application.", doublons)
        else:
            set_meta(conn, "index_jour_unique", "pose")


def _init_journal_vu(conn):
    """À l'arrivée de la colonne, tout ce qui existe déjà compte comme vu —
    sinon la pastille « nouveau » s'allumerait sur tout l'historique."""
    if get_meta(conn, "journal_vu_init") == "1":
        return
    conn.execute("UPDATE users SET journal_vu_id = (SELECT COALESCE(MAX(id), 0) FROM posts)")
    set_meta(conn, "journal_vu_init", "1")


def _init_fetes(conn):
    """À l'arrivée de la colonne, les médailles déjà obtenues comptent comme
    fêtées — sinon le premier lancement ferait défiler tout l'historique."""
    if get_meta(conn, "medailles_fete_init") == "1":
        return
    conn.execute("UPDATE medailles SET fetee=1")
    set_meta(conn, "medailles_fete_init", "1")


def init():
    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.photos_root).mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        for stmt in ALTERS:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError:
                pass  # colonne déjà présente
        _migre_jours(conn)      # remplir day AVANT de poser l'unicité dessus
        _pose_index(conn)
        _seed_users(conn)
        _init_journal_vu(conn)
        _init_fetes(conn)
        conn.commit()
    logger.info("DB initialisée (%s)", settings.db_path)


def own_post_count(conn, user_id: str) -> int:
    """Prochain numéro d'ordre personnel — MAX(seq), pas COUNT(*), pour qu'une
    suppression ne renumérote rien. Sert à l'AFFICHAGE seulement : le déblocage
    passe par jours_remplis()."""
    r = conn.execute("SELECT COALESCE(MAX(seq),0) AS m FROM posts WHERE author_id=?",
                      (user_id,)).fetchone()
    return r["m"]


def jours_remplis(conn, user_id: str) -> set[str]:
    """Les jours qu'un compte a effectivement remplis — c'est CE jeu qui décide
    de ce qu'il voit chez l'autre. Les souvenirs supprimés n'y figurent pas :
    contrairement à seq, un jour libéré redevient à remplir."""
    return {r["day"] for r in conn.execute(
        "SELECT DISTINCT day FROM posts "
        "WHERE author_id=? AND deleted_at IS NULL AND day IS NOT NULL", (user_id,))}


def jour_rempli(conn, user_id: str, day: str) -> bool:
    r = conn.execute(
        "SELECT 1 FROM posts WHERE author_id=? AND day=? AND deleted_at IS NULL LIMIT 1",
        (user_id, day)).fetchone()
    return r is not None


def insert_post(conn, *, author_id: str, day: str, is_catchup: bool,
                 caption: str | None, lat: float, lng: float,
                 location_label: str | None, primary_facing: str,
                 captured_at: str | None) -> dict:
    """Transaction unique : vérifie que le jour est libre, calcule le prochain
    seq et insère la ligne, SANS les chemins photo (post_id pas encore connu —
    voir set_post_photos, appelé une fois les fichiers déplacés vers leur
    emplacement définitif /data/photos/<id>/).

    BEGIN IMMEDIATE + index unique partiel : la vérification et l'insertion sont
    dans la même transaction, et l'index rattrape le cas où deux requêtes du
    MÊME compte arriveraient de front (double appui sur le déclencheur)."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        if jour_rempli(conn, author_id, day):
            raise JourDejaRempli(day)
        seq = own_post_count(conn, author_id) + 1
        cur = conn.execute(
            "INSERT INTO posts (author_id, seq, day, is_catchup, caption, lat, lng, "
            "location_label, primary_facing, captured_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (author_id, seq, day, 1 if is_catchup else 0, caption, lat, lng,
             location_label, primary_facing, captured_at))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        raise JourDejaRempli(day)
    except Exception:
        conn.rollback()
        raise
    return {"id": cur.lastrowid, "seq": seq, "day": day}


def set_post_photos(conn, post_id: int, primary_path: str, secondary_path: str,
                     blur_path: str):
    conn.execute("UPDATE posts SET primary_photo_path=?, secondary_photo_path=?, "
                 "blur_photo_path=? WHERE id=?",
                 (primary_path, secondary_path, blur_path, post_id))
    conn.commit()


def autre_compte(conn, user_id: str) -> str | None:
    r = conn.execute("SELECT id FROM users WHERE id<>? LIMIT 1", (user_id,)).fetchone()
    return r["id"] if r else None


def comptes_commentaires(conn, post_ids: list[int]) -> dict[int, int]:
    """Nombre de commentaires vivants par souvenir, en une requête."""
    if not post_ids:
        return {}
    marques = ",".join("?" * len(post_ids))
    return {r["post_id"]: r["n"] for r in conn.execute(
        f"SELECT post_id, COUNT(*) AS n FROM commentaires "
        f"WHERE deleted_at IS NULL AND post_id IN ({marques}) GROUP BY post_id",
        post_ids)}
