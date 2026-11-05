import { heureFr, dateFr, dateJour, esc as echappe, PIN } from './fmt.js';
import { api } from './api.js';
import { getSession } from './state.js';
import { filLu } from './nouveautes.js';
import { nom, encre, classe, ORDRE, avatarDe, initiale, chargeAvatars } from './personnes.js';
import { IC } from './icones.js';
import { toast, toastErreur, feuilleInfo, slotHtml, brancheSlots, echangePrises,
         glisserPourFermer, empileCouche, depileCouche, oublieCouche } from './composants.js';

export { toast };

const MAX_COMMENT = 500;
const ANNULATION_MS = 4500;   // délai pendant lequel « Annuler » rattrape un mot supprimé

/** L'avatar du compte, en haut à droite de la carte et du journal : c'est la
 *  porte de « Nous », des réglages et de la déconnexion. */
export function peintMoi() {
    const s = getSession();
    document.querySelectorAll('[data-moi]').forEach((b) => {
        b.style.setProperty('--encre-auteur', encre(s?.user_id));
        b.innerHTML = s?.avatar_url
            ? `<img src="${echappe(s.avatar_url)}" alt="">`
            : `<span>${echappe(String(s?.display_name || '?').charAt(0).toUpperCase())}</span>`;
    });
}

/* ── fiche d'un souvenir ──────────────────────────────────────────────────
   Plein écran opaque : ✕ à gauche (comme tout écran modal), enregistrer la
   photo à droite, glisser vers le bas pour fermer. L'incrustation échange les
   deux prises — le même geste que dans le journal et en révision.
   Une fiche ne s'ouvre que pour un souvenir OUVERT : le serveur refuse de
   toute façon le fil d'un verrouillé. */
let ficheOuverte = false;
function cacheFiche() {
    const o = document.getElementById('post-detail');
    if (!o) return;
    ficheOuverte = false;
    o.classList.remove('show');
    o.innerHTML = '';
}
/** Ferme la fiche comme l'interface le fait (consomme l'entrée d'historique). */
export function fermeFiche() { if (ficheOuverte) { depileCouche(cacheFiche); cacheFiche(); } }
/** Ferme sans toucher à l'historique : utilisé pendant un changement d'écran. */
export function hideDetail() { oublieCouche(cacheFiche); cacheFiche(); }

export function showDetail(post, esc = echappe) {
    const overlay = document.getElementById('post-detail');
    const moi = getSession()?.user_id ?? null;
    const qui = nom(post.author_id);
    const quand = `${dateFr(post.created_at)} · ${heureFr(post.created_at)}`;
    const aMoi = post.author_id === moi;

    overlay.innerHTML = `
        <div class="detail-card ${classe(post.author_id)}" role="dialog" aria-modal="true" aria-label="Souvenir de ${esc(qui)}">
            <div class="detail-coins">
                <button class="ico-btn sur-image" data-close-detail aria-label="Fermer">${IC.croix}</button>
                <button class="ico-btn sur-image" data-enregistre aria-label="Enregistrer la photo">${IC.enregistrer}</button>
            </div>
            <div class="detail-stage vue">
                <img class="primary" src="${esc(post.primary_photo_url)}" alt="Souvenir de ${esc(qui)}, ${esc(dateJour(post.day))}">
                <button class="incrust" type="button" data-flip aria-label="Voir l’autre prise">
                    <img src="${esc(post.secondary_photo_url)}" alt="">
                </button>
            </div>
            <div class="detail-meta">
                <div class="detail-sub">
                    <span class="who">${esc(qui)}</span> · ${esc(quand)}${post.is_catchup ? ' · journée rattrapée' : ''}
                    ${post.location_label ? `<div class="detail-lieu">${PIN} ${esc(post.location_label)}</div>` : ''}
                </div>
                <div class="detail-legende">
                    ${post.caption ? `<div class="detail-cap">${esc(post.caption)}</div>` : ''}
                    ${aMoi ? `<button class="lien" data-edit-cap>${post.caption ? 'Modifier la légende' : 'Ajouter une légende'}</button>` : ''}
                </div>
            </div>
            <section class="fil" aria-label="Mots">
                <h2 class="fil-titre">Mots<span class="fil-compte"></span></h2>
                <div class="fil-liste" aria-live="polite"><div class="fil-vide">Chargement des mots…</div></div>
            </section>
            <form class="fil-saisie">
                <textarea class="saisie" rows="1" maxlength="${MAX_COMMENT}" aria-label="Écrire un mot"
                    placeholder="${esc(aMoi ? 'Répondre…' : `Un mot pour ${qui}…`)}"></textarea>
                <button class="envoyer" type="submit" disabled aria-label="Envoyer">${IC.envoyer}</button>
            </form>
        </div>`;

    const dejaOuverte = ficheOuverte;
    ficheOuverte = true;
    overlay.classList.add('show');
    overlay.scrollTop = 0;
    if (!dejaOuverte) empileCouche(cacheFiche);
    overlay.querySelector('[data-close-detail]').addEventListener('click', fermeFiche);
    overlay.querySelector('[data-flip]').addEventListener('click', () =>
        echangePrises(overlay.querySelector('.detail-stage')));
    overlay.querySelector('[data-enregistre]').addEventListener('click', () =>
        enregistrePhoto(overlay.querySelector('img.primary').src,
            overlay.querySelector('.detail-stage .incrust img').src, post));
    if (!overlay.dataset.glisse) {
        overlay.dataset.glisse = '1';
        glisserPourFermer(overlay, overlay, fermeFiche, () => overlay.scrollTop <= 0);
    }
    overlay.querySelector('[data-edit-cap]')?.addEventListener('click', () => editeLegende(post, esc));
    brancheFil(post, esc, moi);
}

/* ── enregistrer : les deux prises en UNE image ────────────────────────────
   Comme à l'écran : la grande photo, l'autre en incrustation dans le coin,
   coins arrondis et filet sombre — dans l'ordre affiché (si on a inversé les
   prises, on enregistre l'inversion). Tout est dessiné à la résolution de la
   grande photo, en proportions : l'incrustation fait 28 % de la largeur. */
const INCRUST_LARGEUR = 0.28;
const INCRUST_MARGE = 0.035;
const INCRUST_RAYON = 0.022;
const INCRUST_FILET = 0.006;

async function bitmap(src) {
    const blob = await (await fetch(src, { credentials: 'include' })).blob();
    return createImageBitmap(blob);
}

/** Dessine img en « cover » dans le rectangle (x, y, w, h). */
function couvre(ctx, img, x, y, w, h) {
    const k = Math.max(w / img.width, h / img.height);
    const sw = w / k, sh = h / k;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

/** roundRect n'existe que depuis Safari 16 : en dessous, des coins droits. */
function arrondi(ctx, x, y, w, h, r) {
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}

async function fusionne(srcGrande, srcPetite) {
    const [g, p] = await Promise.all([bitmap(srcGrande), bitmap(srcPetite)]);
    const c = document.createElement('canvas');
    c.width = g.width;
    c.height = g.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(g, 0, 0);
    const W = c.width;
    const w = Math.round(W * INCRUST_LARGEUR);
    const h = Math.round(w * 4 / 3);
    const m = Math.round(W * INCRUST_MARGE);
    const r = Math.round(W * INCRUST_RAYON);
    const f = Math.max(2, Math.round(W * INCRUST_FILET));
    // le filet sombre, puis la photo dedans, toutes deux arrondies
    ctx.fillStyle = '#14100d';
    ctx.beginPath();
    arrondi(ctx, m - f, m - f, w + 2 * f, h + 2 * f, r + f);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    arrondi(ctx, m, m, w, h, r);
    ctx.clip();
    couvre(ctx, p, m, m, w, h);
    ctx.restore();
    g.close?.(); p.close?.();
    return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('toBlob'))), 'image/jpeg', 0.92));
}

/** Enregistrer : la feuille de partage d'iOS (qui propose « Enregistrer
 *  l'image »), sinon un téléchargement classique. */
async function enregistrePhoto(srcGrande, srcPetite, post) {
    try {
        const blob = await fusionne(srcGrande, srcPetite);
        const fichier = new File([blob], `beus-${post.day || post.id}.jpg`, { type: 'image/jpeg' });
        if (navigator.canShare?.({ files: [fichier] })) {
            await navigator.share({ files: [fichier] });
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fichier.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
        if (e?.name !== 'AbortError') toast('Impossible d’enregistrer la photo', { erreur: true });
    }
}

/* ── le fil ──────────────────────────────────────────────────────────────
   Une conversation, comme dans une messagerie : mes mots à droite, ceux de
   l'autre à gauche avec son visage, chaque bulle teintée de l'encre de son
   auteur (la couleur dit qui parle). Les mots qui se suivent du même auteur
   forment un groupe : un seul visage, une seule heure. Un séparateur horaire
   apparaît quand la conversation reprend après une pause. Toucher SON mot fait apparaître
   « Supprimer », rattrapable quelques secondes. */
const PAUSE_GROUPE_MS = 10 * 60 * 1000;      // au-delà, nouveau groupe
const PAUSE_SEPARATEUR_MS = 60 * 60 * 1000;  // au-delà, nouvelle heure affichée

/** Un visage rond : la photo si elle existe, sinon l'initiale à l'encre. */
export function visageHtml(qui, cls = '') {
    const url = avatarDe(qui);
    return `<span class="visage ${classe(qui)} ${cls}" aria-hidden="true">${url
        ? `<img src="${echappe(url)}" alt="">` : echappe(initiale(qui))}</span>`;
}

const dateDe = (iso) => {
    if (!iso) return null;
    let t = String(iso).trim().replace(' ', 'T');
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) t += 'Z';
    const d = new Date(t);
    return isNaN(d) ? null : d;
};

function separateur(d) {
    const auj = new Date();
    const hier = new Date(auj); hier.setDate(auj.getDate() - 1);
    const iso = d.toISOString();
    const jour = d.toDateString() === auj.toDateString() ? 'Aujourd’hui'
        : d.toDateString() === hier.toDateString() ? 'Hier' : dateFr(iso);
    return `<div class="fil-sep">${echappe(jour)} · ${echappe(heureFr(iso))}</div>`;
}

/** Un mot. `pos` : place dans son groupe ('seul' | 'debut' | 'milieu' | 'fin'). */
export function comHtml(c, moi, esc = echappe, { pos = 'seul', statut = '' } = {}) {
    const aMoi = c.author_id === moi;
    const dernier = pos === 'seul' || pos === 'fin';
    return `
        <div class="msg ${aMoi ? 'moi' : 'autre'} ${pos}${c.enCours ? ' envoi-en-cours' : ''}"
             style="--encre-auteur:${encre(c.author_id)}" data-com="${esc(String(c.id))}">
            ${aMoi ? '' : (dernier ? visageHtml(c.author_id) : '<span class="visage vide"></span>')}
            <div class="msg-corps">
                <span class="sr">${esc(nom(c.author_id))} :</span>
                <p class="bulle"${aMoi && !c.enCours ? ' tabindex="0" role="button" aria-label="Mon mot — toucher pour le supprimer"' : ''}>${esc(c.body)}</p>
                ${dernier ? `<span class="msg-info">${esc(statut || heureFr(c.created_at) || '')}</span>` : ''}
                ${aMoi && !c.enCours ? `<button class="lien" data-retire="${esc(String(c.id))}">Supprimer</button>` : ''}
            </div>
        </div>`;
}

function peintFil(liste, comments, moi, esc) {
    const titre = liste.closest('.fil')?.querySelector('.fil-compte');
    if (titre) titre.textContent = comments.length ? String(comments.length) : '';
    if (!comments.length) {
        liste.innerHTML = '<div class="fil-vide">Aucun mot pour l’instant.<br>Écris le premier.</div>';
        return;
    }
    let html = '';
    comments.forEach((c, i) => {
        const avant = comments[i - 1];
        const apres = comments[i + 1];
        const t = dateDe(c.created_at)?.getTime() ?? Date.now();
        const tAvant = avant ? (dateDe(avant.created_at)?.getTime() ?? Date.now()) : null;
        const tApres = apres ? (dateDe(apres.created_at)?.getTime() ?? Date.now()) : null;
        const coupeAvant = !avant || t - tAvant > PAUSE_SEPARATEUR_MS;
        if (coupeAvant) html += separateur(new Date(t));
        const lieAvant = avant && !coupeAvant && avant.author_id === c.author_id && t - tAvant <= PAUSE_GROUPE_MS;
        const lieApres = apres && apres.author_id === c.author_id && tApres - t <= PAUSE_GROUPE_MS
            && tApres - t <= PAUSE_SEPARATEUR_MS;
        const pos = lieAvant ? (lieApres ? 'milieu' : 'fin') : (lieApres ? 'debut' : 'seul');
        html += comHtml(c, moi, esc, { pos, statut: c.enCours ? 'Envoi…' : '' });
    });
    liste.innerHTML = html;
}

async function brancheFil(post, esc, moi) {
    const overlay = document.getElementById('post-detail');
    const liste = overlay.querySelector('.fil-liste');
    const form = overlay.querySelector('.fil-saisie');
    const zone = form.querySelector('textarea');
    const bouton = form.querySelector('button');
    let comments = [];
    const visibles = () => comments.filter((c) => !c.retire);
    const repeint = () => { if (overlay.contains(liste)) peintFil(liste, visibles(), moi, esc); };

    const ajuste = () => {
        zone.style.height = 'auto';
        zone.style.height = `${Math.min(zone.scrollHeight, 120)}px`;
        bouton.disabled = !zone.value.trim();
    };
    zone.addEventListener('input', ajuste);
    // Entrée envoie sur un clavier physique ; Maj+Entrée va à la ligne.
    zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover:hover)').matches) {
            e.preventDefault();
            form.requestSubmit();
        }
    });

    liste.addEventListener('click', (e) => {
        const b = e.target.closest('[data-retire]');
        if (!b) {
            const mien = e.target.closest('.msg.moi');
            liste.querySelectorAll('.msg.choisi').forEach((c) => { if (c !== mien) c.classList.remove('choisi'); });
            mien?.classList.toggle('choisi');
            return;
        }
        // Retrait différé : le mot disparaît tout de suite, la suppression ne
        // part qu'après le délai d'annulation.
        const c = comments.find((x) => String(x.id) === b.dataset.retire);
        if (!c) return;
        c.retire = true;
        repeint();
        signale(post, visibles().length);
        const minuteur = setTimeout(async () => {
            try {
                await api.del(`/comments/${c.id}`);
                comments = comments.filter((x) => x !== c);
            } catch (err) {
                c.retire = false;
                repeint();
                signale(post, visibles().length);
                toastErreur(err, 'Impossible de supprimer ce mot');
            }
        }, ANNULATION_MS);
        toast('Mot supprimé', { action: { label: 'Annuler', fn: () => {
            clearTimeout(minuteur);
            c.retire = false;
            repeint();
            signale(post, visibles().length);
        } } });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const texte = zone.value.trim();
        if (!texte) return;
        // Affichage immédiat, atténué jusqu'à la réponse du serveur.
        const provisoire = { id: `p${Date.now()}`, author_id: moi, body: texte, enCours: true,
            created_at: new Date().toISOString() };
        comments.push(provisoire);
        zone.value = '';
        ajuste();
        repeint();
        liste.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        try {
            const c = await api.post(`/posts/${post.id}/comments`, { body: texte });
            comments[comments.indexOf(provisoire)] = c;
            repeint();
            signale(post, visibles().length);
        } catch (err) {
            comments = comments.filter((x) => x !== provisoire);
            repeint();
            zone.value = texte;
            ajuste();
            toastErreur(err, 'Le mot n’est pas parti');
        }
    });

    try {
        const [res] = await Promise.all([api.get(`/posts/${post.id}/comments`), chargeAvatars(api)]);
        if (!overlay.contains(liste)) return;   // fiche fermée entre-temps
        comments = res.comments;
        repeint();
        filLu(post.id);
        document.dispatchEvent(new CustomEvent('beus-fil-lu', { detail: { id: post.id } }));
    } catch {
        if (overlay.contains(liste)) liste.innerHTML = '<div class="fil-vide">Les mots n’ont pas pu être chargés</div>';
    }
}

/** Le journal et la carte tiennent le compte à jour sans recharger. */
function signale(post, n) {
    post.comment_count = n;
    document.dispatchEvent(new CustomEvent('beus-post-maj', { detail: { post } }));
}

/* ── actions sur son souvenir ────────────────────────────────────────────── */

function editeLegende(post, esc) {
    const bloc = document.querySelector('#post-detail .detail-legende');
    if (!bloc) return;
    bloc.innerHTML = `
        <textarea class="saisie cap-edit" maxlength="280" rows="2" aria-label="Légende">${esc(post.caption || '')}</textarea>
        <div class="cap-actions">
            <button class="lien" data-annule>Annuler</button>
            <button class="btn btn-plein btn-petit" data-enregistre-cap>Enregistrer</button>
        </div>`;
    const zone = bloc.querySelector('textarea');
    zone.focus();
    bloc.querySelector('[data-annule]').addEventListener('click', () => showDetail(post, esc));
    bloc.querySelector('[data-enregistre-cap]').addEventListener('click', async () => {
        try {
            const maj = await api.patch(`/posts/${post.id}`, { caption: zone.value });
            post.caption = maj.caption;
            document.dispatchEvent(new CustomEvent('beus-post-maj', { detail: { post } }));
            showDetail(post, esc);
            toast('Légende enregistrée');
        } catch (err) { toastErreur(err, 'La légende n’a pas pu être enregistrée'); }
    });
}


/* ── un souvenir verrouillé, expliqué ─────────────────────────────────────
   Une feuille plutôt qu'un toast : la règle tient en une phrase, et l'action
   qui l'ouvre est juste dessous. */
export function expliqueVerrou(p, { aujourdhui }) {
    const qui = nom(p.author_id);
    const hier = p.day !== aujourdhui;
    feuilleInfo({
        visuel: `<div class="fi-vignette">${p.blur_photo_url ? `<img src="${echappe(p.blur_photo_url)}" alt="">` : ''}</div>`,
        titre: `Le souvenir de ${qui} est à ouvrir`,
        texte: hier
            ? `Raconte ta journée d’hier avant minuit pour l’ouvrir. Après, il restera fermé.`
            : `Raconte ta journée pour l’ouvrir.`,
        actions: [
            { label: hier ? 'Raconter hier' : 'Raconter ma journée', classe: 'btn-plein',
              fn: () => document.dispatchEvent(new CustomEvent('beus-combler',
                  { detail: { day: hier ? p.day : null } })) },
            { label: 'Plus tard', classe: 'btn-ghost' },
        ],
    });
}

/* ── feuille de la carte ─────────────────────────────────────────────────────
   Un appui sur un marqueur monte une feuille depuis le bas (comme Plans) : la
   journée entière, en diptyque, avec les mêmes emplacements que le journal. */
function cacheFeuilleBrute() {
    const f = document.getElementById('feuille');
    if (!f || f.hidden) return;
    f.classList.remove('show');
    f.hidden = true;
    f.innerHTML = '';
    document.dispatchEvent(new CustomEvent('beus-feuille-fermee'));
}
export function fermeFeuille() {
    const f = document.getElementById('feuille');
    if (!f || f.hidden) return;
    depileCouche(cacheFeuilleBrute);
    cacheFeuilleBrute();
}
export function hideFeuille() { oublieCouche(cacheFeuilleBrute); cacheFeuilleBrute(); }

export function showFeuille({ day, posts, moi, jours, surJournal, touche = null }) {
    const f = document.getElementById('feuille');
    if (!f) return;
    const parAuteur = Object.fromEntries(posts.map((p) => [p.author_id, p]));
    const aujourdhui = jours?.aujourdhui;
    const ouvrable = !!jours && (day === aujourdhui || (jours.a_combler || []).includes(day));
    // En tête : le lieu du marqueur TOUCHÉ (l'endroit qu'on regarde sur la
    // carte), pas celui du premier souvenir publié ce jour-là. Si les deux
    // n'étaient pas au même endroit, chaque photo porte aussi le sien.
    const lieu = touche?.location_label || posts.map((p) => p.location_label).find(Boolean) || '';
    const lieux = new Set(posts.map((p) => p.location_label).filter(Boolean));
    const lieuParPhoto = lieux.size > 1;
    const relatif = day === aujourdhui ? ' · aujourd’hui' : '';
    const etaitOuverte = !f.hidden;
    f.innerHTML = `
        <div class="poignee" aria-hidden="true"></div>
        <div class="f-tete">
            <div class="f-date">${echappe(dateJour(day))}${relatif}</div>
            ${lieu ? `<div class="f-lieu">${PIN} ${echappe(lieu)}</div>` : ''}
        </div>
        <div class="duo">${ORDRE.map((qui) => slotHtml(qui, parAuteur[qui] || null,
            { day, moi, ouvrable, aujourdhui, compact: true, lieu: lieuParPhoto })).join('')}</div>
        <div class="f-pied"><button class="btn btn-ghost" data-f-journal>Voir dans le journal</button></div>`;
    f.hidden = false;
    requestAnimationFrame(() => f.classList.add('show'));
    if (!etaitOuverte) empileCouche(cacheFeuilleBrute);
    brancheSlots(f, {
        ouvre: (s) => {
            const p = posts.find((x) => String(x.id) === s.dataset.post);
            if (p) showDetail(p, echappe);
        },
        verrou: (s) => {
            const p = parAuteur[s.dataset.auteur];
            if (p) expliqueVerrou(p, { aujourdhui });
        },
        combler: (s) => document.dispatchEvent(new CustomEvent('beus-combler',
            { detail: { day: s.dataset.combler === aujourdhui ? null : s.dataset.combler } })),
    });
    f.querySelector('[data-f-journal]').addEventListener('click', () => surJournal?.(day));
    if (!f.dataset.glisse) {
        f.dataset.glisse = '1';
        glisserPourFermer(f, f, fermeFeuille);
    }
}
