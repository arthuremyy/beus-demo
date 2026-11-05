// Capture façon BeReal : une seule pression, deux clichés séquentiels (jamais
// simultanés — iOS Safari ne tient pas deux flux caméra en même temps de façon
// fiable). La caméra affichée en premier (avant/arrière selon ce que
// l'utilisateur a choisi) est capturée en premier, puis on bascule
// automatiquement sur l'autre — avec une vraie seconde pour se repositionner
// avant le second cliché, pas un aller-retour instantané.
import { getJourVise, setJourVise, setPendingCapture, getSession } from '../state.js';
import { dateJour, resteDeLaJournee } from '../fmt.js';
import { api } from '../api.js';
import { toast, slotHtml, brancheSlots } from '../composants.js';
import { showDetail } from '../ui.js';
import { ORDRE } from '../personnes.js';

let currentFacing = 'environment';
let stream = null;
let geoCoords = null;
let capturing = false;

const LIBELLE = { environment: 'Arrière', user: 'Avant' };
const DELAI_BASCULE_MS = 1000; // temps pour se repositionner avant le 2e cliché
// Côté long maximal envoyé. Le serveur ré-encode de toute façon ; envoyer le
// 4K brut du capteur coûtait plusieurs Mo par photo en 4G pour rien.
const COTE_MAX = 2048;
const QUALITE_JPEG = 0.85;
// Sans résolution demandée, Safari ouvre la caméra en VGA (480×640) : c'est
// ce que gardaient les premiers souvenirs. On demande du 4:3 à 1440 px de
// petit côté (au moins du 1080p), en `ideal` : un appareil qui ne l'a pas
// rend sa meilleure approximation au lieu d'échouer.
const RESOLUTION = { width: { ideal: 1920 }, height: { ideal: 1440 } };

function video() { return document.getElementById('cam-video'); }

function setGeoStatus(text, etat) {
    const s = document.getElementById('cam-geo');
    s.querySelector('span').textContent = text;
    s.classList.toggle('ok', etat === 'ok');
    s.classList.toggle('ko', etat === 'ko');
    updateShutter();
}

function setFacingLabel() {
    document.getElementById('cam-facing').textContent = LIBELLE[currentFacing];
    // La caméra avant est inversée à l'écran, comme un miroir : sinon on se
    // voit « à l'envers » et le cadrage devient contre-intuitif.
    video().classList.toggle('mirror', currentFacing === 'user');
}

/* Pastille de bascule entre les deux clichés — un indicateur, pas une phrase. */
function transition(actif) {
    document.getElementById('cam-step').classList.toggle('on', actif);
}

function flash() {
    const f = document.getElementById('cam-flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
}

/* aria-disabled plutôt que disabled : un bouton désactivé avale le toucher
   sans rien dire. Ici le toucher reste perçu, et on montre ce qui manque. */
function updateShutter() {
    const btn = document.getElementById('cam-shutter');
    btn.setAttribute('aria-disabled', String(capturing || !stream || !geoCoords));
}
function pretAPrendre() { return !capturing && !!stream && !!geoCoords; }
function signaleCeQuiManque() {
    if (!stream) { montreRefus(true); return; }
    const g = document.getElementById('cam-geo');
    g.classList.remove('secoue');
    void g.offsetWidth;
    g.classList.add('secoue');
}

/* ── Choix de la caméra ─────────────────────────────────────────────────────

   But : la vue arrière cadre large, comme le 0,5× de l'app Photos.

   Ce qu'un iPhone expose réellement (relevé iOS 18 / Safari 27, cinq caméras,
   via `assets/diag-camera.html`) :

     « Caméra ultra grand angle avant »     facingMode user
     « Double caméra grand angle arrière »  facingMode environment, zoom 0,5 → 10
     « Caméra ultra grand angle arrière »   facingMode environment
     « Caméra arrière »                     facingMode environment
     « Caméra avant »                       facingMode user

   ⚠ Ne JAMAIS choisir un objectif par son NOM : « ultra grand angle » désigne
   aussi une caméra AVANT, et c'est elle qu'on servait pour la vue arrière —
   d'où les deux clichés de face. Le nom ne dit pas le côté de façon fiable, et
   il change avec la langue du téléphone.

   La bonne porte est le ZOOM. La caméra arrière par défaut est la caméra
   VIRTUELLE de l'appareil : elle descend jusqu'à 0,5× et bascule d'objectif
   toute seule, exactement comme l'app Photos. On l'ouvre normalement, puis on
   élargit le champ au minimum qu'elle annonce. Un appareil sans ultra
   grand-angle annonce un zoom minimal de 1 : l'élargissement ne fait alors
   rien et on garde sa caméra arrière normale. */

/** Élargit le champ au maximum de ce que l'objectif sait faire. Sans effet —
 *  et sans erreur — là où le zoom n'est pas réglable. */
async function elargitLeChamp(flux) {
    const piste = flux?.getVideoTracks?.()[0];
    if (!piste?.getCapabilities) return;
    try {
        const zoom = piste.getCapabilities().zoom;
        if (zoom && zoom.min < 1) await piste.applyConstraints({ zoom: zoom.min });
    } catch { /* zoom non réglable : on garde le cadrage par défaut */ }
}

async function fluxPour(facing) {
    let flux;
    try {
        // Le bon côté, EXIGÉ : `ideal` n'est qu'une préférence, le navigateur a
        // le droit de rendre l'autre caméra sans lever la moindre erreur.
        flux = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: facing }, ...RESOLUTION }, audio: false,
        });
    } catch {
        // Appareil à une seule caméra (ordinateur, caméra de test).
        flux = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facing }, ...RESOLUTION }, audio: false,
        });
    }
    if (facing === 'environment') await elargitLeChamp(flux);
    return flux;
}

/* Caméra refusée ou absente : un panneau en place qui dit quoi faire,
   plutôt qu'un écran noir et un toast de trois secondes. */
function montreRefus(oui) { document.getElementById('cam-refus').hidden = !oui; }

async function startStream(facing) {
    try {
        stream = await fluxPour(facing);
        video().srcObject = stream;
        await video().play().catch(() => {});
        montreRefus(false);
    } catch {
        stream = null;
        montreRefus(true);
    }
    setFacingLabel();
    updateShutter();
}

function stopStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
}

let geoWatching = false;
function startGeo() {
    if (geoWatching) return;
    geoWatching = true;
    geoCoords = null;
    setGeoStatus('Recherche de la position…');
    if (!navigator.geolocation) { setGeoStatus('Position indisponible', 'ko'); return; }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            geoCoords = pos.coords;
            setGeoStatus('Position trouvée', 'ok');
        },
        // Sans position, le déclencheur reste grisé : il faut une sortie.
        // Après un refus, réessayer ne sert à rien sur iOS tant que l'accès
        // n'est pas rouvert dans les réglages — on dit où.
        (err) => {
            geoWatching = false;
            setGeoStatus(err?.code === 1 ? 'Position refusée · Réglages › Safari › Position'
                                         : 'Position introuvable · Toucher pour réessayer', 'ko');
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
}

function grabFrame() {
    const v = video();
    const canvas = document.createElement('canvas');
    const w = v.videoWidth || 720;
    const h = v.videoHeight || 1280;
    const echelle = Math.min(1, COTE_MAX / Math.max(w, h));
    canvas.width = Math.round(w * echelle);
    canvas.height = Math.round(h * echelle);
    const ctx = canvas.getContext('2d');
    /* La caméra avant est affichée en miroir (comme une glace) : sans ça on se
       voit « à l'envers » et le cadrage devient impossible. Mais le flux brut,
       lui, n'est PAS inversé — on enregistrait donc une image différente de
       celle qu'on venait de cadrer, et le résultat paraissait faux.
       On applique ici la même inversion qu'à l'écran : ce qu'on voit est ce
       qu'on garde. */
    if (currentFacing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITE_JPEG));
}

async function flip() {
    if (capturing) return;
    currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
    stopStream();
    await startStream(currentFacing);
}

async function shoot() {
    if (!pretAPrendre()) { if (!capturing) signaleCeQuiManque(); return; }
    capturing = true;
    updateShutter();
    try {
        const primaryFacing = currentFacing;
        flash();
        const primaryBlob = await grabFrame();
        stopStream();

        const otherFacing = primaryFacing === 'environment' ? 'user' : 'environment';
        transition(true);
        currentFacing = otherFacing;
        await startStream(otherFacing);
        // Vraie pause pour se repositionner (sourire, cadrage…) avant le 2e cliché.
        await new Promise((r) => setTimeout(r, DELAI_BASCULE_MS));
        transition(false);
        flash();
        const secondaryBlob = await grabFrame();
        stopStream();

        setPendingCapture({
            primaryBlob, secondaryBlob, primaryFacing,
            lat: geoCoords.latitude, lng: geoCoords.longitude,
            accuracy: geoCoords.accuracy || null,
        });
        window.location.hash = '#/review';
        return; // pas de updateShutter ici : on quitte l'écran
    } catch {
        transition(false);
        toast('La prise a échoué, réessaie', { erreur: true });
        await startStream(currentFacing);
    }
    capturing = false;
    updateShutter();
}

function close() {
    stopStream();
    window.location.hash = '#/map';
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('cam-shutter').addEventListener('click', shoot);
    document.getElementById('cam-flip').addEventListener('click', flip);
    document.getElementById('cam-close').addEventListener('click', close);
    document.getElementById('cam-geo').addEventListener('click', () => {
        if (document.getElementById('cam-geo').classList.contains('ko')) startGeo();
    });
    document.getElementById('bloc-fermer').addEventListener('click', close);
    document.getElementById('refus-fermer').addEventListener('click', close);
    document.getElementById('refus-reessayer').addEventListener('click', () => startStream(currentFacing));
    document.getElementById('bloc-retour').addEventListener('click', () => {
        window.location.hash = '#/feed';
    });
    document.getElementById('bloc-hier').addEventListener('click', (e) => {
        const j = e.currentTarget.dataset.jour;
        if (!j) return;
        setJourVise(j);
        document.getElementById('cam-bloc').hidden = true;
        render();   // on relance l'écran, cette fois sur le jour comblé
    });
}

/* Quand on rattrape un jour passé, l'écran le dit — c'est la seule
   information écrite de cette vue, et elle est indispensable : la position
   enregistrée sera celle de MAINTENANT, pas celle du jour rattrapé. */
function afficheJourVise() {
    const chip = document.getElementById('cam-jour');
    const j = getJourVise();
    if (!j) { chip.hidden = true; return; }
    chip.textContent = `Pour hier, ${dateJour(j)}`;
    chip.hidden = false;
}

/* Ce qu'on a posé aujourd'hui, et la place de l'autre : l'écran n'est plus
   un cul-de-sac, il montre la journée en cours — avec les mêmes emplacements
   que le journal. */
async function peintDuoDuJour(j) {
    const duo = document.getElementById('bloc-duo');
    duo.innerHTML = '';
    let posts = [];
    try { posts = (await api.post('/posts/feed', { limit: 4 })).posts || []; } catch { return; }
    const duJour = posts.filter((p) => p.day === j.aujourdhui);
    const parAuteur = Object.fromEntries(duJour.map((p) => [p.author_id, p]));
    const moi = getSession()?.user_id;
    duo.innerHTML = ORDRE.map((qui) => slotHtml(qui, parAuteur[qui] || null, {
        day: j.aujourdhui, moi, ouvrable: true, aujourdhui: j.aujourdhui, compact: true, lieu: false,
    })).join('');
    brancheSlots(duo, { ouvre: (s) => {
        const p = duJour.find((x) => String(x.id) === s.dataset.post);
        if (p) showDetail(p);
    } });
}

/* Journée déjà racontée : on le dit AVANT, et on n'allume pas la caméra.
   Auparavant on laissait prendre les deux photos, et le refus (409) ne tombait
   qu'au moment de publier — après tout le travail. Rien dans l'écran n'indiquait
   qu'on avait déjà publié le sien ce jour-là. */
async function journeeBloquee() {
    const bloc = document.getElementById('cam-bloc');
    bloc.hidden = true;
    // Un jour explicitement visé (rattrapage depuis le journal) n'est jamais
    // bloqué ici : c'est le serveur qui tranche sa validité.
    if (getJourVise()) return false;

    let j = null;
    try { j = await api.get('/jours'); } catch { return false; }  // hors ligne : on laisse faire
    if (!j?.aujourdhui_rempli) return false;

    document.getElementById('bloc-reste').textContent =
        `Nouvelle journée dans ${resteDeLaJournee().texte}`;
    peintDuoDuJour(j);

    // La veille est encore comblable : on propose l'action plutôt que de
    // renvoyer l'utilisateur chercher le bouton dans le journal.
    const hier = (j.a_combler || [])[0] || null;
    const btnHier = document.getElementById('bloc-hier');
    btnHier.hidden = !hier;
    btnHier.dataset.jour = hier || '';

    bloc.hidden = false;
    return true;
}

export async function render() {
    wire();
    capturing = false;
    transition(false);
    afficheJourVise();
    currentFacing = 'environment';
    if (await journeeBloquee()) return;   // caméra jamais démarrée
    startGeo();
    await startStream(currentFacing);
}

export function teardown() {
    stopStream();
    transition(false);
    document.getElementById('cam-bloc').hidden = true;
    montreRefus(false);
}
