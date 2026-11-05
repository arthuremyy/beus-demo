// Init MapLibre — pile reprise de un prototype antérieur (satellite
// Esri + relief Terrarium DEM + projection globe + ciel), mais INTERACTIVE
// (l'ancien site pilotait la caméra par diapos ; ici on navigue librement).
//
// MapLibre v6 n'expose plus de bundle UMD (window.maplibregl) : seul un module
// ES (dist/maplibre-gl.mjs) est publié. Chargé via un import() DYNAMIQUE (pas
// un <script> ni un import statique en tête de fichier) pour qu'un échec
// réseau ne fasse tomber que la vue carte — le reste de l'app (login, flux,
// capture, admin) doit rester utilisable même si le CDN est injoignable.
const ML_URL = 'https://unpkg.com/maplibre-gl@6.10.0/dist/maplibre-gl.mjs';

/* Vue d'ouverture quand il n'y a encore rien à cadrer : l'Europe de l'ouest,
   là où vivent les deux comptes. Dès qu'un souvenir existe, la caméra se règle
   sur les souvenirs eux-mêmes (fitAll) et cette valeur ne sert plus. */
export const VUE_DEPART = { center: [6.5, 48.5], zoom: 4.2 };
let mlPromise = null;
function loadML() {
    if (!mlPromise) mlPromise = import(/* webpackIgnore: true */ ML_URL);
    return mlPromise;
}

/* Échelle des marqueurs selon le zoom — courbe en cloche.
   Trop gros en vue monde, les bustes photo recouvraient des continents ; trop
   gros en vue rue, ils masquaient l'endroit qu'ils désignent. On les garde
   donc petits aux deux extrêmes et pleine taille à l'échelle d'une ville,
   là où reconnaître la photo a un sens. */
const PALIERS = [
    [0, 0.5], [3, 0.55], [7, 1], [13, 1], [17, 0.45], [22, 0.4],
];

export function markerScaleForZoom(zoom) {
    const z = Math.max(0, Math.min(22, zoom));
    for (let i = 1; i < PALIERS.length; i++) {
        const [z1, s1] = PALIERS[i];
        if (z <= z1) {
            const [z0, s0] = PALIERS[i - 1];
            const t = z1 === z0 ? 0 : (z - z0) / (z1 - z0);
            return +(s0 + (s1 - s0) * t).toFixed(3);
        }
    }
    return PALIERS[PALIERS.length - 1][1];
}

function applyScale(map, container) {
    container.style.setProperty('--mks', String(markerScaleForZoom(map.getZoom())));
}

export async function createMap(containerId) {
    const { Map } = await loadML();
    return new Promise((resolve, reject) => {
        let map;
        try {
            map = new Map({
                container: containerId,
                style: {
                    version: 8,
                    sources: {
                        sat: { type: 'raster', tileSize: 256, maxzoom: 17,
                            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                            attribution: '© Esri' },
                        dem: { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14,
                            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                            attribution: 'Mapzen' },
                    },
                    layers: [
                        { id: 'bg', type: 'background', paint: { 'background-color': '#0a1220' } },
                        { id: 'sat', type: 'raster', source: 'sat',
                          paint: { 'raster-fade-duration': 250, 'raster-saturation': -0.12, 'raster-brightness-max': .92 } },
                    ],
                },
                center: VUE_DEPART.center, zoom: VUE_DEPART.zoom, pitch: 0, bearing: 0,
                maxPitch: 60,
                // `compact: false` : un crédit en toutes lettres, discret et NON
                // cliquable, au lieu du bouton « ⓘ » qui n'ouvrait qu'un pavé de
                // texte. Esri et Mapzen exigent ce crédit pour l'usage de leurs
                // tuiles — on ne peut pas le retirer, seulement l'effacer
                // visuellement (voir .maplibregl-ctrl-attrib dans style.css).
                attributionControl: { compact: false },
                // Confort tactile : deux doigts pour tourner/incliner, jamais par accident.
                pitchWithRotate: false, dragRotate: false, touchPitch: false,
            });
        } catch (e) { reject(e); return; }

        map.on('error', () => {}); // tuiles manquantes, non fatal
        map.on('style.load', () => {
            try { map.setProjection({ type: 'globe' }); } catch {}
            try { map.setTerrain({ source: 'dem', exaggeration: 1.35 }); } catch {}
            try {
                map.setSky({
                    'sky-color': '#0b1230', 'horizon-color': '#1a2450', 'fog-color': '#070812',
                    'sky-horizon-blend': .6, 'horizon-fog-blend': .6, 'fog-ground-blend': .7,
                    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 1, 8, 0],
                });
            } catch {}
        });
        map.on('load', () => {
            const container = document.getElementById(containerId);
            container.classList.add('ready');

            // Ni boutons de zoom ni géolocalisation : le pincement suffit, et
            // « tout voir » recadre. La carte doit rester nue, bord à bord.
            // Pas de barre d'échelle : c'est un affichage de DISTANCE, et l'app
            // n'en montre nulle part (elle doit dire la même chose que les deux
            // comptes soient dans la même pièce ou à l'autre bout du monde).

            applyScale(map, container);
            map.on('zoom', () => applyScale(map, container));
            resolve(map);
        });
    });
}

/** Marker ancré par la POINTE (anchor 'bottom') : la coordonnée exacte est
 *  sous le petit point, pas sous la photo. */
export async function makeMarker(element, lngLat) {
    const { Marker } = await loadML();
    return new Marker({ element, anchor: 'bottom' }).setLngLat(lngLat);
}

export async function makeBounds(points) {
    const { LngLatBounds } = await loadML();
    return points.reduce((b, p) => b.extend(p), new LngLatBounds(points[0], points[0]));
}

function shell(cls) {
    const d = document.createElement('div');
    d.className = 'mk ' + cls;
    const inner = document.createElement('div');
    inner.className = 'mk-in';
    d.appendChild(inner);
    return { root: d, inner };
}

const qui = (authorId) => (authorId === 'alex' ? 'alex' : 'sam');

/* Qui fournit l'adresse du visage d'un auteur (posé par la vue carte) : sans
   import de personnes.js ici, maplib reste chargeable seul par les tests. */
let visage = null;
export function fournisseurVisage(fn) { visage = fn; }

/** La vignette dans son cadre ; l'initiale de l'auteur posée sur le coin —
 *  la couleur seule ne suffit pas à dire qui (daltonisme, lecture rapide).
 *  L'initiale est hors de la bulle, qui coupe ce qui dépasse. */
function cadre(inner, bubble, authorId) {
    const c = document.createElement('div');
    c.className = 'mk-cadre';
    c.appendChild(bubble);
    if (authorId) {
        const ini = document.createElement('span');
        ini.className = 'mk-ini';
        ini.setAttribute('aria-hidden', 'true');
        // Le visage s'il existe, sinon l'initiale.
        const url = visage?.(authorId);
        if (url) {
            const img = document.createElement('img');
            img.src = url; img.alt = '';
            ini.classList.add('photo');
            ini.appendChild(img);
        } else {
            ini.textContent = authorId === 'alex' ? 'A' : 'S';
        }
        c.appendChild(ini);
    }
    inner.appendChild(c);
}

function addStem(inner) {
    const stem = document.createElement('div');
    stem.className = 'mk-stem';
    const dot = document.createElement('div');
    dot.className = 'mk-dot';
    inner.append(stem, dot);
}

const CADENAS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/>'
    + '<path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/** Marqueur débloqué : vignette photo au-dessus de la pointe. */
export function unlockedMarkerEl(authorId, photoUrl) {
    const { root, inner } = shell(qui(authorId));
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', `Souvenir de ${authorId === 'alex' ? 'Alex' : 'Sam'}`);
    const bubble = document.createElement('div');
    bubble.className = 'mk-bubble';
    const img = document.createElement('img');
    img.src = photoUrl; img.alt = ''; img.loading = 'lazy';
    bubble.appendChild(img);
    cadre(inner, bubble, authorId);
    addStem(inner);
    return root;
}

/** Groupe de souvenirs trop proches pour être distingués à ce zoom.
 *  Un seul marqueur « pile » avec le compte, qui s'ouvre au clic. */
export function clusterMarkerEl(count, coverUrl, dominant, lesDeux = false) {
    // Un groupe qui contient des souvenirs des DEUX : c'est un endroit où vous
    // êtes passés tous les deux — la surimpression, et rien d'autre, le dit.
    const { root, inner } = shell('cluster ' + (lesDeux ? 'deux' : qui(dominant)));
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', `${count} souvenirs ici`);
    const bubble = document.createElement('div');
    bubble.className = 'mk-bubble stack';
    if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl; img.alt = ''; img.loading = 'lazy';
        bubble.appendChild(img);
    } else {
        // Aucun souvenir débloqué dans ce groupe : il doit se lire comme
        // verrouillé, sinon une pile grise ressemble à un groupe ordinaire.
        root.classList.add('mystery');
    }
    const n = document.createElement('span');
    n.className = 'count';
    n.textContent = String(count);
    bubble.appendChild(n);
    cadre(inner, bubble, lesDeux ? null : dominant);
    addStem(inner);
    return root;
}

/** Marqueur verrouillé : même gabarit, la vignette FLOUTÉE du serveur à la
 *  place de la photo, un petit cadenas dessus, et le cadre en pointillés.
 *  Sans vignette (ligne ancienne) : une bulle vide, jamais la photo pleine. */
export function mysteryMarkerEl(authorId, blurUrl) {
    const { root, inner } = shell('mystery ' + qui(authorId));
    root.setAttribute('role', 'button');
    root.setAttribute('aria-label', `Souvenir de ${authorId === 'alex' ? 'Alex' : 'Sam'}, à ouvrir`);
    const bubble = document.createElement('div');
    bubble.className = 'mk-bubble';
    if (blurUrl) {
        const img = document.createElement('img');
        img.src = blurUrl; img.alt = ''; img.loading = 'lazy';
        bubble.appendChild(img);
    }
    const c = document.createElement('span');
    c.className = 'mk-cadenas';
    c.innerHTML = CADENAS;
    bubble.appendChild(c);
    cadre(inner, bubble, authorId);
    addStem(inner);
    return root;
}
