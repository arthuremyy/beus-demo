/* Révision — un écran MODAL : ✕ à gauche (qui demande avant de jeter les
   photos), titre centré. On y inverse les prises en touchant l'incrustation,
   comme partout ailleurs, on ajoute une légende, puis on raconte.

   Hors ligne : la capture est déjà gardée dans IndexedDB (state.js). Un envoi
   qui échoue faute de réseau est relancé tout seul au retour du réseau. */
import { api } from '../api.js';
import { getPendingCapture, clearPendingCapture, getJourVise, setJourVise, restoreCapture } from '../state.js';
import { toast, toastErreur, dialogue, echangePrises, etatHtml } from '../composants.js';
import { PIN, esc, dateJour, jourLocal } from '../fmt.js';

let objectUrls = [];
let swapped = false;   // l'utilisateur a inversé les deux prises avant publication
let envoiEnCours = false;
let enAttenteDeReseau = false;
let lieuPour = null;   // clé de la position dont le libellé est affiché

function el() { return document.getElementById('view-review'); }
function revoke() { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls = []; }

function parts(c) {
    // « swapped » échange l'affichage ET l'envoi : ce qui part en primary_photo
    // est bien la photo affichée en grand.
    return swapped
        ? { big: c.secondaryBlob, small: c.primaryBlob,
            facing: c.primaryFacing === 'environment' ? 'user' : 'environment' }
        : { big: c.primaryBlob, small: c.secondaryBlob, facing: c.primaryFacing };
}

/* Minuit passé entre la prise et la publication : la photo part sur le jour
   où elle a été prise, et l'écran le dit. Le serveur reste juge. */
function jourDeLaPhoto(c) {
    const vise = getJourVise();
    if (vise) return vise;
    if (c?.prisLe && c.prisLe !== jourLocal()) { setJourVise(c.prisLe); return c.prisLe; }
    return null;
}

/* Le lieu lisible plutôt que des coordonnées : on le demande au serveur
   (Nominatim, mis en file à 1/s). En attendant, ou s'il ne répond pas, on dit
   simplement que le lieu sera ajouté. */
async function peintLieu(c) {
    const geo = el().querySelector('.review-geo');
    const cle = `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`;
    if (lieuPour === cle && geo.dataset.label) return;
    lieuPour = cle;
    geo.dataset.label = '';
    geo.innerHTML = `${PIN}<span>Recherche du lieu…</span>`;
    let label = null;
    try { label = (await api.get(`/lieu?lat=${c.lat}&lng=${c.lng}`)).label; } catch { /* hors ligne */ }
    if (lieuPour !== cle) return;
    geo.dataset.label = label || '';
    geo.innerHTML = `${PIN}<span>${esc(label || 'Le lieu sera ajouté à la publication')}</span>`;
}

function paint() {
    const c = getPendingCapture();
    const stage = el().querySelector('.review-stage');
    const vide = el().querySelector('.empty-hint');
    const pleins = ['.review-geo', '.review-actions', '.caption-input', '.astuce'].map((s) => el().querySelector(s));

    if (!c) {
        stage.innerHTML = '';
        vide.innerHTML = etatHtml({ titre: 'Rien à publier', texte: 'Les photos de ta journée apparaîtront ici.',
            action: { id: 'empty-back', label: 'Prendre une photo' } });
        vide.querySelector('#empty-back').addEventListener('click', () => { window.location.hash = '#/capture'; });
        vide.hidden = false;
        pleins.forEach((n) => { n.hidden = true; });
        el().querySelector('#review-titre').textContent = 'Ta journée';
        return;
    }
    vide.hidden = true;
    pleins.forEach((n) => { n.hidden = false; });

    const jour = jourDeLaPhoto(c);
    el().querySelector('#review-titre').textContent = jour ? `Pour hier, ${dateJour(jour)}` : 'Ta journée';
    document.getElementById('review-publish').textContent = jour ? 'Raconter hier' : 'Raconter ma journée';

    revoke();
    const { big, small } = parts(c);
    const bigUrl = URL.createObjectURL(big);
    const smallUrl = URL.createObjectURL(small);
    objectUrls.push(bigUrl, smallUrl);
    stage.innerHTML = `<img class="primary" src="${bigUrl}" alt="Ta photo principale">
        <button class="incrust" type="button" aria-label="Inverser les deux prises"><img src="${smallUrl}" alt=""></button>`;
    stage.querySelector('.incrust').addEventListener('click', () => {
        swapped = !swapped;
        echangePrises(stage);
    });
    peintLieu(c);
}

function progression(f) {
    const barre = el().querySelector('.envoi');
    barre.hidden = f == null;
    barre.querySelector('i').style.width = `${Math.round((f || 0) * 100)}%`;
}

async function publish() {
    const c = getPendingCapture();
    if (!c || envoiEnCours) return;
    envoiEnCours = true;
    const btn = document.getElementById('review-publish');
    const libelle = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Envoi…';
    progression(0);
    try {
        const { big, small, facing } = parts(c);
        const form = new FormData();
        form.append('primary_photo', big, 'primary.jpg');
        form.append('secondary_photo', small, 'secondary.jpg');
        form.append('primary_facing', facing);
        form.append('lat', String(c.lat));
        form.append('lng', String(c.lng));
        const caption = el().querySelector('.caption-input').value.trim();
        if (caption) form.append('caption', caption);
        form.append('captured_at', new Date().toISOString());
        const jour = getJourVise();
        if (jour) form.append('day', jour);
        // L'autre avait-il déjà raconté ce jour ? C'est ce qui décide si les
        // anneaux se croisent après publication.
        const etat = await api.get('/jours').catch(() => null);
        const ceJour = jour || etat?.aujourdhui;
        const deux = !!etat?.jours?.find((x) => x.day === ceJour)?.autre;
        const res = await api.postForm('/posts', form, progression);
        enAttenteDeReseau = false;
        clearPendingCapture();
        revoke();
        swapped = false;
        el().querySelector('.caption-input').value = '';
        document.dispatchEvent(new CustomEvent('beus-published', { detail: { ...res, deux } }));
        window.location.hash = '#/map';
    } catch (e) {
        if (e.horsLigne || navigator.onLine === false) {
            // La capture est en IndexedDB : on la relance au retour du réseau.
            enAttenteDeReseau = true;
            toast('Pas de réseau : ta journée partira dès qu’il revient');
        } else {
            toastErreur(e, 'La publication a échoué');
        }
    } finally {
        envoiEnCours = false;
        btn.disabled = false;
        btn.textContent = libelle;
        progression(null);
    }
}

async function fermer() {
    if (getPendingCapture()) {
        const oui = await dialogue({ titre: 'Jeter ces photos ?', texte: 'Elles ne seront pas publiées.',
            confirmer: 'Jeter', danger: true });
        if (!oui) return;
    }
    clearPendingCapture();
    revoke();
    swapped = false;
    enAttenteDeReseau = false;
    window.location.hash = '#/map';
}

function refaire() {
    clearPendingCapture();
    revoke();
    swapped = false;
    enAttenteDeReseau = false;
    window.location.hash = '#/capture';
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('review-publish').addEventListener('click', publish);
    document.getElementById('review-discard').addEventListener('click', refaire);
    document.getElementById('review-fermer').addEventListener('click', fermer);
    window.addEventListener('online', async () => {
        if (!enAttenteDeReseau) return;
        if (!getPendingCapture()) await restoreCapture();
        if (getPendingCapture()) { toast('Réseau revenu, envoi de ta journée…'); publish(); }
    });
}

export async function render() {
    wire();
    if (!getPendingCapture()) await restoreCapture();
    paint();
}
export function teardown() { /* les URL restent valides tant que la capture attend */ }

