# BeUs : fonctionnement

## La mécanique — tout repose sur `posts.day`

Un souvenir par **jour calendaire et par compte**, et le jour est **parisien** :
`services/jour.py` le calcule avec `ZoneInfo` à l'insertion et le stocke dans
`posts.day`. Il n'est **jamais** re-dérivé de `created_at` (qui est de l'UTC : un
souvenir publié à 00h30 à Paris compterait pour la veille).

- **Déblocage** (`services/reveal.py`) : on voit le souvenir de l'autre pour un jour
  donné après avoir rempli **ce jour-là**. Ni compteur, ni numéro d'ordre.
  `posts.seq` existe encore mais ne décide **plus rien** — ne pas lui redonner de pouvoir.
- **Rattrapage : UN SEUL jour, la veille** (`FENETRE_RATTRAPAGE = 1`).
  `POST /posts` accepte `day` dans `[J-1, J]` ; hors fenêtre → 422, jour déjà
  rempli → 409. La **position reste celle de maintenant** (on ne réécrit pas le
  GPS) : d'où le marqueur `is_catchup`.
  > On était à 7 jours : le journal affichait « 7 journées à rattraper » dès le
  > premier jour d'usage, alors qu'il n'y avait rien à rattraper, et le
  > rendez-vous quotidien n'avait plus de poids. **Une journée close l'est
  > définitivement dans les deux sens** : le déblocage étant par jour, qui n'a
  > pas rempli le sien ne verra JAMAIS celui de l'autre pour cette date. Le
  > journal l'écrit (« perdue », `.slot.verrou.perdue`) au lieu de promettre
  > « à ouvrir » indéfiniment.
  > ⚠ Conséquence pour les tests : les seules dates publiables étant aujourd'hui
  > et la veille, les fixtures occupent forcément la journée en cours — publier
  > un vrai souvenir pendant une passe de tests renvoie 409.
- **Unicité** : index **partiel** `(author_id, day) WHERE deleted_at IS NULL`. Partiel
  parce que la table garde ses pierres tombales — sinon un jour supprimé serait
  interdit pour toujours. S'il ne peut pas se poser (doublons vivants), `db._pose_index`
  le **journalise en erreur** et marque `meta.index_jour_unique = absent`.

## Souvenir verrouillé : visible, mais étanche

Un verrouillé apparaît dans le journal ET sur la carte, avec sa date, son auteur,
son lieu et une **vignette floutée**. Ce qui ne sort jamais avant déblocage : la
**légende** et les **photos pleines**.

> Le flou est fabriqué **au serveur** (`services/storage.py`, réduction à 32 px puis
> ré-agrandissement + flou, ~1 Ko). ⛔ Ne JAMAIS flouter en CSS : ce serait livrer la
> photo entière au navigateur, et la règle tomberait avec l'inspecteur d'éléments.
> `GET /photos/{id}/blur` est le seul emplacement servi sans vérifier le déblocage.

## Médailles — deux familles

`services/medals.py` : la **condition reste dérivée**, seule l'**attribution** est
persistée (table `medailles`), parce qu'une médaille a une date et ne se fête qu'une
fois. Une médaille obtenue **ne se reprend jamais**, même si un souvenir supprimé
rend la condition fausse. Les règles sont des fonctions **pures** d'un état agrégé
(`backend/test_medals.py`, sans DB ni réseau).

- **Seul** : paliers de volume (1/10/50/100/365), 5 villes, 2 pays, avant 7 h, après 23 h.
- **À deux** : côte à côte (< 100 m le même jour), ×10, même ville, à 5 min près,
  semaine et mois de jours consécutifs remplis par les deux.

> ⛔ **La distance n'est JAMAIS affichée.** Décision produit : l'app doit dire la même
> chose quand les deux comptes sont dans la même pièce et quand ils sont loin. Elle ne
> sert qu'à trancher `cote_a_cote`.

| Fichier | Rôle |
|---|---|
| `backend/app.py` | FastAPI — middleware JWT, `PUBLIC_PATHS` + `PUBLIC_PATTERNS` (l'avatar est public : l'écran de connexion l'affiche avant toute session) |
| `backend/db.py` | Schéma, `ALTERS` additifs, migration du jour, index partiel, `jours_remplis()` |
| `backend/services/jour.py` | Le jour parisien, la fenêtre de rattrapage — fonctions pures |
| `backend/services/reveal.py` | La règle de déblocage — pure, une seule fonction |
| `backend/services/medals.py` | Les deux familles, règles pures + attribution |
| `backend/services/storage.py` | Validation Pillow, ré-encodage JPEG (purge l'EXIF/GPS), vignette floutée |
| `backend/services/geocode.py` | Nominatim 1 req/s — libellé lisible **et** ville/pays structurés (les médailles ne comptent pas sur du texte libre) |
| `frontend/assets/js/medals-art.js` | Dessin SVG des 15 médailles |
| `frontend/assets/css/style.css` | La charte « Deux encres » — ce qui y est **banni** est écrit en tête du fichier |

## Charte visuelle — « Deux encres »

**Rose = Sam, or = Alex**, et **la surimpression** (`--surimpr`) là où les deux se
croisent : elle n'apparaît que pour dire « ça, vous l'avez fait à deux ».
La correspondance personne → couleur n'existe qu'à DEUX endroits :
`--encre-sam` / `--encre-alex` dans `style.css`, et `personnes.js` (noms,
ordre Sam | Alex, `encre()`, `classe()`). Jamais `--rose`/`--or` pour une
personne dans une règle ou une vue. Les icônes de l'app ont été mises en miroir
(anneau rose à gauche).
**La couleur désigne une personne, jamais un bouton ni un état** : l'interface
est en craie et en brun (bouton principal = craie pleine `.btn-plein`, onglet
actif = craie, pastille « nouveau » = carré de craie). Erreur et action
destructive : `--alerte`, l'encre de personne. Aplats francs, filets fins, deux rayons (2 px / 6 px), le cercle réservé
aux visages. **Seule exception : la barre du bas** (2026-10-02), capsule de verre
flottante façon iOS 26 (`backdrop-filter` flou + saturation, filet spéculaire,
repli opaque si « Réduire la transparence »). Pas de réfraction : les filtres SVG
en `backdrop-filter` ne rendent pas sous Safari. Le contenu passe dessous :
réserver `--navpied` (et non `--navh + --bas`) sous tout ce qui touche le bas.
Bannis ailleurs : verre dépoli, dégradés de fond, lueurs colorées, halos
pulsés, pastilles arrondies partout, **petites capitales espacées en surtitre**,
**bordure de couleur à gauche** des cartes/photos (tics d'interface générée).
Casse normale partout, **majuscule écrite à la source** (le toast ne la met
plus ; `toastErreur` la pose seulement sur les messages du serveur). Tutoiement,
« vous » réservé au couple. Vocabulaire : **raconter** (publier), **rattraper**
(la veille), **mot** (commentaire), **à ouvrir / perdue** (verrouillé).
**Fraunces uniquement** pour le logo et les numéros de jour ; tout le reste en
Archivo, sur l'échelle `--t-*` en `rem` (elle suit la taille de texte d'iOS via
`font: -apple-system-body`). Zoom autorisé (plus de `user-scalable=no`).
Aucune valeur en px en dur hors de `:root`, sauf dimensions d'objet.

### Composants communs (`composants.js`)

| Composant | Rôle |
|---|---|
| `slotHtml` / `brancheSlots` | L'emplacement (4 états × 2 tailles) et ses gestes |
| `toast(msg, { action, erreur })` | Retour d'une action, « Annuler » si réversible — jamais une explication |
| `feuilleInfo` | Feuille sur voile (médaille, souvenir à ouvrir) |
| `dialogue` | Confirmation (remplace `window.confirm`, banni) |
| `etatHtml` | État vide / erreur avec son action |
| `squeletteJournal` / `squeletteMedailles` | Chargement (plus de texte « Chargement… ») |

`moments.js` : l'**accueil** (3 écrans, une fois par compte et par appareil,
clé `localStorage` `beus:accueil:<compte>`) et le **moment de publication**
(anneaux qui se croisent si l'autre avait déjà raconté). `icones.js` : le seul
jeu d'icônes SVG (plus de glyphes ✕ › +).

Hors ligne : bandeau `#hors-ligne` ; une publication qui échoue faute de réseau
est relancée seule au retour du réseau (la capture est en IndexedDB). La
révision affiche le **lieu lisible** via `GET /lieu?lat&lng` (Nominatim, file à
1 req/s, rien n'est stocké). Les souvenirs ouverts portent aussi
`blur_photo_url` : la vignette floue tient la place pendant le chargement.

## Pièges

- **Le flux est classé par `(day, id)`, pas par `id`.** Un jour comblé après coup
  reçoit un `id` plus grand que des souvenirs de jours postérieurs : trier par `id`
  remontait le 19 au-dessus du 20. Le curseur de pagination est donc **double**
  (`before_day` + `before_id`, comparaison de n-uplets SQLite).
- **Caméra : ne jamais choisir un objectif par son NOM.** Un iPhone expose cinq
  caméras, dont « Caméra ultra grand angle **avant** » : un filtre sur « ultra
  grand angle » servait donc la caméra avant pour la vue arrière (deux clichés
  de face). Le côté s'obtient par `facingMode: { exact: ... }` — `ideal` n'est
  qu'une préférence, le navigateur peut rendre l'autre caméra sans erreur — et
  le cadrage large par la contrainte `zoom` portée à son minimum (0,5 sur la
  caméra virtuelle arrière, comme le 0,5× de l'app Photos).
- **La selfie enregistrée est inversée comme l'aperçu.** L'aperçu avant est en
  miroir (sinon le cadrage est impossible) mais le flux brut ne l'est pas : le
  canvas applique donc la même inversion, sinon on garde autre chose que ce
  qu'on a cadré.
- **Barre d'état iOS en `black`, jamais `black-translucent`** : sur iOS 26, en
  app ajoutée à l'écran d'accueil, `black-translucent` dessine la page depuis
  le haut de l'écran mais raccourcit sa hauteur de celle de la barre d'état —
  la barre du bas flottait ~60 pt au-dessus du bord (bug WebKit connu).
- **`[hidden]` doit rester `!important`** dans le CSS : une règle de base qui fixe un
  `display` l'emporte sinon, et la nav est restée affichée par-dessus le déclencheur
  de caméra (deux fois). Couvert par `tests/chrome.mjs`.

## Sécurité

L'application est exposée directement : son durcissement est porté par le code et le conteneur.

- **En-têtes de sécurité** posés par un middleware (`app.py`, `security_headers`,
  défini en dernier = le plus externe) : CSP, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`. La **CSP garde `script-src` serré** (self + unpkg +
  jsdelivr, les seules origines de code) — c'est la défense anti-XSS. ⚠ Ne pas
  resserrer `style-src`/`connect-src` sans re-tester la carte : MapLibre charge
  son CSS depuis unpkg et ses **tuiles par `fetch`** (arcgisonline + s3.amazonaws),
  pas en `<img>` — les retirer de `connect-src` vide la carte silencieusement.
- **`openapi_url=None`** : /openapi.json était public (schéma complet de l'API).
  /docs et /redoc étaient déjà coupés.
- **Bombe de décompression** : `services/storage.py` plafonne à 40 Mpx AVANT
  décodage (dimensions lues dans l'en-tête) + `Image.MAX_IMAGE_PIXELS`. Le
  contrôle de taille (15 Mo) ne suffit pas — un aplat de 30000² fait quelques Ko.
- **Conteneur durci** : `user: "1000:1000"`, `cap_drop: ALL`, `no-new-privileges`, `mem_limit: 512m`.
- Vérifié sain : SQL 100 % paramétré, `esc()` sur tout champ libre (bio, nom,
  légende), PINs bcrypt + lockout 5 essais/15 min, secret JWT 64 car., algo JWT
  épinglé HS256, cookie `httponly+secure+samesite=lax`, aucun port Docker exposé.

