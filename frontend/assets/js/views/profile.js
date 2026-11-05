/* ============================================================================
   Nous — qui est qui, ce que chacun a fait, ce que chacun a gagné.
   Le serveur DÉRIVE les compteurs des souvenirs (services/medals.py) : rien
   n'est tenu à jour ici, on affiche ce qu'on reçoit. Les médailles arrivent
   déjà triées, obtenues d'abord.

   Les réglages (notifications, nom, déconnexion, admin) ne sont plus au pied
   de cette page : on scrollait quinze médailles pour les trouver. Ils vivent
   dans leur écran, derrière l'engrenage en haut à droite (settings.js).
   ========================================================================== */
import { api } from '../api.js';
import { esc, dateFr } from '../fmt.js';
import { medailleSvg } from '../medals-art.js';
import { getSession } from '../state.js';
import { peintMoi } from '../ui.js';
import { toast, toastErreur, feuilleInfo, etatHtml, squeletteMedailles } from '../composants.js';
import { IC } from '../icones.js';
import { ORDRE, nom, classe, majAvatar } from '../personnes.js';
import { recadre } from '../recadrage.js';

let profil = null;
let chargePour = null;
let vue = null;        // le compte affiché ('sam' | 'alex') — moi par défaut

function el() { return document.getElementById('view-profile'); }
function initiale(n) { return esc(String(n || '?').trim().charAt(0).toUpperCase()); }

/* Les compteurs tiennent en UNE phrase. */
function compteursHtml(c) {
    const s = (n, un, plus) => `<b>${esc(String(n))}</b> ${n > 1 ? plus : un}`;
    return `<p class="compteurs">${[
        s(c.souvenirs, 'souvenir', 'souvenirs'),
        s(c.villes, 'ville', 'villes'),
        s(c.pays, 'pays', 'pays'),
        s(c.jours_a_deux, 'jour à deux', 'jours à deux'),
    ].join(' · ')}</p>`;
}

function medaillesHtml(liste, auteurId) {
    return `<div class="medailles">${liste.map((m) => `
        <button class="medaille${m.obtenue ? '' : ' non'}" type="button" data-medaille="${esc(m.code)}"
                aria-label="${esc(m.titre)}, ${m.obtenue ? 'obtenue' : `${m.avancement} sur ${m.cible}`}">
            ${medailleSvg(m, auteurId)}
            <span class="t">${esc(m.titre)}</span>
            <span class="a">${m.obtenue ? 'Obtenue' : `${m.avancement} / ${m.cible}`}</span>
        </button>`).join('')}</div>`;
}

/* Sam | Alex, dans l'ordre fixe de l'app. Le profil de l'autre se lit
   (médailles, compteurs, deux mots) mais ne se modifie pas. */
function bascule() {
    return `<div class="bascule" role="group" aria-label="Profil affiché">${ORDRE.map((id) =>
        `<button class="${classe(id)}" data-vue="${esc(id)}" aria-pressed="${vue === id}">${esc(nom(id))}</button>`).join('')}
    </div>`;
}

/** Une médaille touchée : sa feuille — le grand sceau, ce qui la vaut, et la
 *  date d'obtention ou l'avancement. */
function detailMedaille(m, auteurId) {
    feuilleInfo({
        visuel: medailleSvg(m, auteurId),
        titre: m.titre,
        texte: m.description,
        meta: m.obtenue
            ? (m.obtenue_le ? `Obtenue le ${dateFr(m.obtenue_le)}` : 'Obtenue')
            : `${m.avancement} sur ${m.cible}`,
        actions: [{ label: 'Fermer', classe: 'btn-ghost' }],
    });
}

function paint() {
    if (!profil) return;
    const p = profil;
    const moi = getSession()?.user_id ?? null;
    const aMoi = vue === moi;
    const avatar = p.avatar_url
        ? `<img src="${esc(p.avatar_url)}" alt="">`
        : `<span class="ph">${initiale(p.display_name)}</span>`;
    el().querySelector('.scroll').innerHTML = `
        ${bascule()}
        <div class="profil-tete ${classe(p.id)}">
            ${aMoi ? `<label class="profil-ava" aria-label="Ma photo de profil">
                <span class="rond">${avatar}</span>
                <span class="crayon">${IC.crayon}</span>
                <input type="file" accept="image/*" id="ava-input">
            </label>` : `<div class="profil-ava"><span class="rond">${avatar}</span></div>`}
            <div>
                <div class="profil-nom">${esc(p.display_name)}</div>
                ${p.bio ? `<div class="profil-bio">${esc(p.bio)}</div>` : ''}
            </div>
        </div>
        ${compteursHtml(p.compteurs)}
        <h2 class="section">Médailles<span>${p.medailles.total_obtenues} sur ${p.medailles.total}</span></h2>
        <h3 class="sous-section">Seul</h3>
        ${medaillesHtml(p.medailles.solo, p.id)}
        <h3 class="sous-section">À deux</h3>
        ${medaillesHtml(p.medailles.couple, p.id)}`;
    el().querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.vue === vue) return;
        vue = b.dataset.vue;
        charge();
    }));
    el().querySelector('#ava-input')?.addEventListener('change', envoieAvatar);
    // Avec une photo, le toucher propose de la changer ou de la retirer ;
    // sans photo, il ouvre directement la galerie (comportement du label).
    el().querySelector('label.profil-ava')?.addEventListener('click', (e) => {
        if (!p.avatar_url || e.target.id === 'ava-input') return;
        e.preventDefault();
        feuilleInfo({
            titre: 'Photo de profil',
            actions: [
                // .click() reste dans le geste de l'utilisateur : iOS ouvre la galerie
                { label: 'Changer la photo', classe: 'btn-plein', fn: () => el().querySelector('#ava-input')?.click() },
                { label: 'Supprimer la photo', classe: 'btn-ghost alerte', fn: supprimeAvatar },
                { label: 'Annuler', classe: 'btn-ghost' },
            ],
        });
    });
    el().querySelectorAll('[data-medaille]').forEach((n) =>
        n.addEventListener('click', () => {
            const m = [...p.medailles.solo, ...p.medailles.couple].find((x) => x.code === n.dataset.medaille);
            if (m) detailMedaille(m, p.id);
        }));
}

async function envoieAvatar(e) {
    const f = e.target.files?.[0];
    e.target.value = '';   // choisir deux fois la même photo doit redéclencher
    if (!f) return;
    // Recadrage dans le rond avant l'envoi ; la sortie est un carré de 640 px
    // (ce qui règle aussi les photos de galerie trop grandes pour le serveur).
    const carre = await recadre(f);
    if (!carre) return;
    const form = new FormData();
    form.append('avatar', carre, 'avatar.jpg');
    try {
        await api.postForm('/users/me/avatar', form);
        // Paramètre anti-cache : l'URL de l'avatar ne change pas d'une photo à l'autre.
        // L'adresse est versionnée par le serveur : la nouvelle photo s'affiche
        // partout (avatar, mots, carte) sans resservir l'ancienne du cache.
        profil = await api.get('/users/me');
        const s = getSession();
        if (s) { s.avatar_url = profil.avatar_url; majAvatar(s.user_id, profil.avatar_url); peintMoi(); }
        paint();
        toast('Photo de profil mise à jour');
    } catch (err) {
        toastErreur(err, 'Cette image n’a pas été acceptée');
    }
}

async function supprimeAvatar() {
    try {
        await api.del('/users/me/avatar');
        profil = await api.get('/users/me');
        const s = getSession();
        if (s) { s.avatar_url = null; majAvatar(s.user_id, null); peintMoi(); }
        paint();
        toast('Photo de profil supprimée');
    } catch (err) {
        toastErreur(err, 'La suppression a échoué');
    }
}

export function reset() { profil = null; chargePour = null; vue = null; }

async function charge() {
    const demande = vue;
    const moi = getSession()?.user_id;
    try {
        const p = await api.get(demande === moi ? '/users/me'
            : `/users/${encodeURIComponent(demande)}/profil`);
        if (demande !== vue) return;     // l'autre onglet a été choisi entre-temps
        profil = p;
        paint();
    } catch {
        const scroll = el().querySelector('.scroll');
        scroll.innerHTML = bascule() + etatHtml({ titre: 'Profil indisponible', texte: 'Vérifie la connexion.',
            action: { id: 'profil-reessayer', label: 'Réessayer' }, erreur: true });
        scroll.querySelector('#profil-reessayer').addEventListener('click', charge);
        scroll.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => {
            vue = b.dataset.vue; charge();
        }));
    }
}

export async function render() {
    const moi = getSession()?.user_id ?? null;
    if (chargePour === moi && profil) { paint(); return; }
    reset();
    chargePour = moi;
    vue = moi;
    el().querySelector('.scroll').innerHTML = `<div class="profil-tete"><div class="profil-ava squelette"></div>
        <div class="squelette sq-ligne" style="width:40%"></div></div>${squeletteMedailles(6)}`;
    await charge();
}
