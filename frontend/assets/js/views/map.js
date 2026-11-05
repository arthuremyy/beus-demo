import { api } from '../api.js';
import { esc } from '../fmt.js';
import { createMap, makeMarker, makeBounds, unlockedMarkerEl, mysteryMarkerEl,
         clusterMarkerEl, VUE_DEPART, fournisseurVisage } from '../maplib.js';
import { avatarDe, chargeAvatars } from '../personnes.js';

fournisseurVisage(avatarDe);
import { getSession, setJourVise } from '../state.js';
import { showFeuille, fermeFeuille, hideFeuille } from '../ui.js';
import { etatHtml } from '../composants.js';

// supercluster : la bibliothèque de regroupement de Mapbox (celle que MapLibre
// utilise lui-même pour les sources GeoJSON). Ici en HTML plutôt qu'en couche
// GL, parce que nos marqueurs sont des vignettes photo, pas des ronds.
// Build ESM groupé de jsDelivr (~7 Ko) ; chargé à la demande comme MapLibre,
// pour qu'une panne de CDN ne coûte que le regroupement, pas la carte.
const SC_URL = 'https://cdn.jsdelivr.net/npm/supercluster@9.1.0/+esm';
let scPromise = null;
function loadSC() {
    if (!scPromise) scPromise = import(/* webpackIgnore: true */ SC_URL).then((m) => m.default);
    return scPromise;
}

let map = null;
let mapPromise = null;
let markers = [];
let lastPosts = [];
let index = null;          // instance supercluster
let selectedId = null;
let redrawT = null;
/* Deux rendus peuvent se chevaucher : celui d'un compte qui attendait encore
   le chargement de MapLibre peut se terminer APRÈS celui du compte suivant et
   réafficher ses marqueurs — des souvenirs verrouillés apparaissaient alors en
   clair. Chaque rendu porte un jeton ; seul le plus récent a le droit d'écrire. */
let generation = 0;
let donneesPour = null;   // compte auquel appartiennent index/marqueurs
let aCentrer = null;      // souvenir tout juste publié : la carte s'y pose
let jours = null;         // GET /jours : quels jours me sont encore ouverts
/* « Recentrer » n'apparaît que quand la vue a quitté le cadrage d'ensemble :
   affiché en permanence, il n'avait rien à dire. */
let recadree = true;
function montreRecentrer(oui) { document.getElementById('map-fit').hidden = !oui; }

function camPadding() {
    const h = window.innerHeight;
    // Le bas est plus chargé (bandeau, barre, feuille) que le haut.
    return { top: Math.round(h * 0.14), bottom: Math.round(h * 0.3), left: 42, right: 42 };
}

async function ensureMap() {
    if (map) return map;
    if (!mapPromise) {
        mapPromise = createMap('map').catch((e) => {
            document.body.classList.add('nomap');
            mapPromise = null;
            throw e;
        });
    }
    map = await mapPromise;
    window.__beusMap = map;   // accroche de vérification (tests/map-ux.mjs)
    map.on('moveend', scheduleRedraw);
    map.on('zoomend', scheduleRedraw);
    // Un geste de l'utilisateur (et non une animation lancée par l'app) sort
    // du cadrage d'ensemble : « Recentrer » apparaît.
    map.on('movestart', (e) => { if (e.originalEvent) { recadree = false; montreRecentrer(true); } });
    // Un appui sur la carte elle-même (pas un marqueur) range la feuille.
    map.on('click', () => fermeFeuille());
    return map;
}

function scheduleRedraw() {
    clearTimeout(redrawT);
    redrawT = setTimeout(() => { draw().catch(() => {}); }, 120);
}

function clearMarkers() {
    markers.forEach((m) => m.remove());
    markers = [];
}

function select(id) {
    selectedId = id;
    markers.forEach((m) => m.getElement()
        .classList.toggle('sel', String(m._beusId) === String(id)));
}

const ZOOM_FOCUS = 15.2;

function focusOn(post) {
    if (!map || post.lat == null) return;
    select(post.id);
    montreRecentrer(true);
    map.easeTo({ center: [post.lng, post.lat], zoom: Math.max(map.getZoom(), ZOOM_FOCUS),
                  padding: camPadding(), duration: 900 });
}

async function fitAll(instant = false) {
    if (!map) return;
    recadree = true;
    montreRecentrer(false);
    const avec = lastPosts.filter((p) => p.lat != null && p.lng != null);
    if (!avec.length) {
        map.easeTo({ ...VUE_DEPART, duration: instant ? 0 : 800 });
        return;
    }
    if (avec.length === 1) {
        map.easeTo({ center: [avec[0].lng, avec[0].lat], zoom: 12.5,
                      padding: camPadding(), duration: instant ? 0 : 800 });
        return;
    }
    const bounds = await makeBounds(avec.map((p) => [p.lng, p.lat]));
    map.fitBounds(bounds, { padding: camPadding(), maxZoom: 13, duration: instant ? 0 : 900 });
}

/* Un marqueur ouvre la JOURNÉE, pas seulement le souvenir : la feuille montre
   le diptyque de ce jour-là, ouvert ou flouté selon la règle de déblocage. */
function onPostClick(p, me) {
    focusOn(p);
    const duJour = lastPosts.filter((x) => x.day === p.day);
    showFeuille({
        day: p.day, posts: duJour.length ? duJour : [p], moi: me, jours, touche: p,
        surJournal: (d) => { window.location.hash = `#/feed?d=${d}`; },
    });
}

async function buildIndex(posts) {
    const Supercluster = await loadSC();
    index = new Supercluster({ radius: 64, maxZoom: 16, minPoints: 2 });
    index.load(posts
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
            type: 'Feature',
            properties: { post: p },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })));
}

/** Bornes pour supercluster. En vue globe, getBounds() peut déborder de
 *  [-180,180] : au-delà d'un tour du monde on interroge la planète entière. */
function bbox() {
    const b = map.getBounds();
    const w = b.getWest(), e = b.getEast();
    if (!isFinite(w) || !isFinite(e) || e - w >= 360 || map.getZoom() < 3) {
        return [-180, -85, 180, 85];
    }
    return [w, Math.max(-85, b.getSouth()), e, Math.min(85, b.getNorth())];
}

function coverOf(feuilles) {
    const ouvert = feuilles.find((f) => f.properties.post.unlocked);
    return ouvert ? ouvert.properties.post.primary_photo_url : null;
}

async function draw(gen = generation) {
    if (!map || !index || gen !== generation) return;
    const me = getSession()?.user_id ?? null;
    const zoom = Math.round(map.getZoom());
    const amas = index.getClusters(bbox(), zoom);

    clearMarkers();
    for (const f of amas) {
        const [lng, lat] = f.geometry.coordinates;
        if (f.properties.cluster) {
            const n = f.properties.point_count;
            const feuilles = index.getLeaves(f.properties.cluster_id, 8);
            const dominant = feuilles[0]?.properties.post.author_id;
            const auteurs = new Set(index.getLeaves(f.properties.cluster_id, Infinity)
                .map((x) => x.properties.post.author_id));
            const el = clusterMarkerEl(n, coverOf(feuilles), dominant, auteurs.size > 1);
            const marker = await makeMarker(el, [lng, lat]);
            marker.addTo(map);
            el.addEventListener('click', async (e) => {
                e.stopPropagation();
                // Ouvrir le groupe = aller au zoom où il se sépare.
                const z = index.getClusterExpansionZoom(f.properties.cluster_id);
                map.easeTo({ center: [lng, lat], zoom: Math.min(z + 0.4, 18),
                              padding: camPadding(), duration: 800 });
            });
            markers.push(marker);
        } else {
            const p = f.properties.post;
            const el = p.unlocked
                ? unlockedMarkerEl(p.author_id, p.primary_photo_url)
                : mysteryMarkerEl(p.author_id, p.blur_photo_url);
            const marker = await makeMarker(el, [lng, lat]);
            marker._beusId = p.id;
            marker.addTo(map);
            el.addEventListener('click', (e) => { e.stopPropagation(); onPostClick(p, me); });
            markers.push(marker);
        }
    }
    if (gen !== generation) { clearMarkers(); return; }
    if (selectedId) select(selectedId);
    window.__beusMarkers = markers;
}

/* Bandeau de carte — UNE phrase, jamais une liste, et elle mène quelque part.

   Il en enchaînait plusieurs séparées par des points, et elles se
   contredisaient : « votre première journée vous attend · 7 jours à combler »
   dit à la fois qu'on n'a rien publié et qu'on a sept retards. Les deux
   viennent pourtant du même état.

   Une seule règle désormais : on affiche l'action la plus utile du moment,
   dans cet ordre. Rien d'autre.

   Aucune notion de distance ici non plus : l'app doit dire la même chose quand
   les deux comptes sont dans la même pièce et quand ils sont loin. */
const FLECHE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

function messageHud(stats) {
    if (!stats) return null;

    // Rien n'existe encore : ni retard ni compteur n'auraient de sens.
    if (!stats.total_souvenirs) return { texte: 'Ta première journée t’attend', va: 'capture' };

    // Pas encore racontée aujourd'hui : c'est l'action du jour, elle passe
    // avant tout — et c'est elle qui ouvre ce que l'autre a déjà posé.
    if (stats.aujourdhui_rempli === false) {
        return stats.verrouilles
            ? { texte: 'Raconte ta journée pour ouvrir la sienne', va: 'capture' }
            : { texte: 'Raconte ta journée', va: 'capture' };
    }

    // Tout est fait : la série est ce qui motive à ne pas la casser demain.
    if (stats.serie >= 2) return { texte: `${stats.serie} jours d’affilée à deux`, va: 'feed' };

    const n = stats.total_souvenirs;
    return { texte: `${n} souvenir${n > 1 ? 's' : ''} à vous deux`, va: 'feed' };
}

/* Le bandeau ne s'affiche qu'une fois son message connu : avant, il montait
   vide (une capsule sans texte) pendant le chargement. */
function renderHud(stats) {
    const wrap = document.getElementById('map-hud');
    const m = messageHud(stats);
    const surCarte = document.getElementById('view-map').classList.contains('active');
    if (!m || !surCarte) { wrap.hidden = true; return; }
    const b = wrap.querySelector('.hud');
    b.classList.toggle('appel', m.va === 'capture');
    b.innerHTML = `<span>${esc(m.texte)}</span>${FLECHE}`;
    b.onclick = () => {
        if (m.va === 'capture') setJourVise(null);
        window.location.hash = `#/${m.va}`;
    };
    wrap.hidden = false;
}

/* La carte n'a pas pu se charger : un état en place, avec de quoi repartir. */
function montreErreur(oui) {
    const z = document.getElementById('map-erreur');
    if (!oui) { z.hidden = true; z.innerHTML = ''; return; }
    z.innerHTML = `<div class="etat-carte">${etatHtml({
        titre: 'Carte indisponible', texte: 'Vérifie la connexion, ou passe par le journal en attendant.',
        action: { id: 'map-reessayer', label: 'Réessayer' }, erreur: true })}
        <div style="text-align:center;padding-bottom:var(--e4)"><button class="lien" id="map-vers-journal">Ouvrir le journal</button></div></div>`;
    z.hidden = false;
    z.querySelector('#map-reessayer').addEventListener('click', () => { montreErreur(false); render(); });
    z.querySelector('#map-vers-journal').addEventListener('click', () => { window.location.hash = '#/feed'; });
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('map-fit').addEventListener('click', () => fitAll());
}

let firstLoad = true;

// Après publication, on revient sur la carte, posée sur le nouveau point.
document.addEventListener('beus-published', (e) => { aCentrer = e.detail?.id ?? null; });

export function teardown() { hideFeuille(); }

export async function render() {
    wire();
    const moi = getSession()?.user_id ?? null;
    const gen = ++generation;

    // Changement de compte : on efface AVANT de charger, pour qu'aucun
    // marqueur du compte précédent ne reste à l'écran entre-temps.
    if (donneesPour !== moi) {
        clearMarkers();
        index = null;
        lastPosts = [];
        selectedId = null;
        firstLoad = true;
        donneesPour = moi;
    }

    montreErreur(false);
    try {
        await ensureMap();
    } catch {
        document.getElementById('map-hud').hidden = true;
        montreErreur(true);
        return;
    }
    if (gen !== generation) return;

    try {
        const [{ posts }, , stats, j] = await Promise.all([
            api.get('/posts/map'),
            chargeAvatars(api),
            api.get('/stats').catch(() => null),
            api.get('/jours').catch(() => null),
        ]);
        if (gen !== generation) return;
        lastPosts = posts;
        jours = j;
        await buildIndex(posts);
        if (gen !== generation) return;
        const pose = aCentrer && posts.find((p) => p.id === aCentrer && p.lat != null);
        if (pose) { firstLoad = false; aCentrer = null; focusOn(pose); }
        else if (firstLoad) { await fitAll(true); firstLoad = false; }
        await draw(gen);
        if (gen !== generation) return;
        renderHud(stats);
    } catch {
        montreErreur(true);
    }
}
