/* ============================================================================
   Les composants communs — un objet, un seul HTML, partout.

   Avant, chaque vue écrivait le sien : l'emplacement d'un souvenir existait
   en trois versions (journal, feuille de carte, journée déjà racontée), et
   deux d'entre elles écrivaient « À ouvrir » sur une journée close. Tout ce
   qui se répète d'un écran à l'autre vit ici :

     slotHtml      l'emplacement (4 états × 2 tailles)
     toast         le retour d'une action (avec « Annuler » si réversible)
     feuilleInfo   une feuille qui monte du bas, sur un voile
     dialogue      la confirmation (remplace window.confirm)
     etatHtml      état vide / erreur, avec son action
     couches       la pile des feuilles ouvertes, branchée sur l'historique
                   (le geste « retour » ferme la feuille au lieu de l'app)
   ========================================================================== */
import { esc, heureFr, dateJour, PIN } from './fmt.js';
import { IC, ANNEAUX } from './icones.js';
import { nom, classe } from './personnes.js';

/* ── la pile des couches et l'historique ──────────────────────────────────
   Chaque feuille ou fiche ouverte pousse une entrée d'historique : le retour
   (Android, navigateur, glissé) la ferme au lieu de quitter l'écran. */
const pile = [];

export function empileCouche(cacher) {
    pile.push(cacher);
    try { history.pushState({ beusCouche: pile.length }, ''); } catch { /* ignore */ }
}

/** Fermeture voulue par l'interface (✕, voile, glissé) : on consomme aussi
 *  l'entrée d'historique, sinon le prochain « retour » ne ferait rien. */
export function depileCouche(cacher) {
    const i = pile.lastIndexOf(cacher);
    if (i < 0) return;
    pile.splice(i, 1);
    if (history.state?.beusCouche) history.back();
}

/** Fermeture pendant une navigation (changement d'onglet) : l'entrée reste,
 *  la naviguer serait annuler le changement d'écran en cours. */
export function oublieCouche(cacher) {
    const i = pile.lastIndexOf(cacher);
    if (i >= 0) pile.splice(i, 1);
}

globalThis.window?.addEventListener?.('popstate', (e) => {
    const n = e.state?.beusCouche || 0;
    while (pile.length > n) pile.pop()();
});

/* ── glisser vers le bas pour fermer ───────────────────────────────────────
   Le geste des feuilles iOS. Ne démarre que si le contenu est tout en haut,
   sinon on volerait le défilement. */
export function glisserPourFermer(zone, cible, fermer, estEnHaut = () => true) {
    let y0 = null;
    let dy = 0;
    zone.addEventListener('touchstart', (e) => {
        y0 = estEnHaut() ? e.touches[0].clientY : null;
        dy = 0;
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
        if (y0 == null) return;
        dy = e.touches[0].clientY - y0;
        if (dy <= 0) { cible.style.transform = ''; return; }
        cible.style.transition = 'none';
        cible.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    zone.addEventListener('touchend', () => {
        if (y0 == null) return;
        cible.style.transition = '';
        cible.style.transform = '';
        if (dy > 90) fermer();
        y0 = null;
    });
}

/* ── toast ────────────────────────────────────────────────────────────────
   Le RETOUR d'une action, rien d'autre : une règle à expliquer va dans une
   feuille. Les phrases arrivent écrites avec leur majuscule. */
let toastTimer = null;
export function toast(msg, { action = null, erreur = false, duree } = {}) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.classList.toggle('erreur', !!erreur);
    t.innerHTML = `${erreur ? `<span class="t-ic">${IC.attention}</span>` : ''}`
        + `<span class="t-texte">${esc(msg || '')}</span>`
        + (action ? `<button class="t-action" type="button">${esc(action.label)}</button>` : '');
    if (action) {
        t.querySelector('.t-action').addEventListener('click', () => {
            cacheToast();
            action.fn();
        }, { once: true });
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(cacheToast, duree || (action ? 4500 : erreur ? 4000 : 2800));
}
export function cacheToast() {
    clearTimeout(toastTimer);
    document.getElementById('toast')?.classList.remove('show');
}
/** Erreur d'un appel : le message du serveur s'il en a un, sinon le nôtre. */
export function toastErreur(err, defaut) {
    // Hors ligne, le message du réseau n'apprend rien : on dit la vraie cause.
    const brut = navigator.onLine === false ? 'Pas de réseau pour l’instant' : (err?.data?.detail || defaut);
    const msg = String(brut || '');
    toast(msg.charAt(0).toUpperCase() + msg.slice(1), { erreur: true });
}

/* ── feuille d'info ───────────────────────────────────────────────────────── */
export function feuilleInfo({ visuel = '', titre = '', texte = '', meta = '', actions = [], classe: cls = '', surFermeture = null }) {
    const voile = document.createElement('div');
    voile.className = 'voile-feuille';
    voile.innerHTML = `
        <div class="feuille-info ${cls}" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
            <div class="poignee" aria-hidden="true"></div>
            <div class="fi-corps">
                ${visuel ? `<div class="fi-visuel">${visuel}</div>` : ''}
                ${titre ? `<div class="fi-titre">${esc(titre)}</div>` : ''}
                ${texte ? `<p class="fi-texte">${esc(texte)}</p>` : ''}
                ${meta ? `<div class="fi-meta">${esc(meta)}</div>` : ''}
            </div>
            <div class="fi-actions">${actions.map((a, i) =>
                `<button class="btn ${a.classe || 'btn-ghost'}" data-i="${i}" type="button">${esc(a.label)}</button>`).join('')}
            </div>
        </div>`;
    let ferme = false;
    const cacher = () => {
        if (ferme) return;
        ferme = true;
        surFermeture?.();
        voile.classList.add('part');
        setTimeout(() => voile.remove(), 200);
        document.removeEventListener('keydown', echap);
    };
    const fermer = () => { depileCouche(cacher); cacher(); };
    const echap = (e) => { if (e.key === 'Escape') fermer(); };
    document.addEventListener('keydown', echap);
    voile.addEventListener('click', (e) => { if (e.target === voile) fermer(); });
    voile.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
        // L'action AVANT la fermeture : si elle navigue, la fermeture ne doit
        // pas rejouer un « retour » d'historique par-dessus.
        actions[Number(b.dataset.i)].fn?.();
        fermer();
    }));
    const carte = voile.querySelector('.feuille-info');
    glisserPourFermer(carte, carte, fermer);
    document.body.appendChild(voile);
    empileCouche(cacher);
    voile.querySelector('.fi-actions .btn')?.focus({ preventScroll: true });
    return fermer;
}

/** Confirmation : la feuille d'action d'iOS. Résout true si on confirme. */
export function dialogue({ titre, texte = '', confirmer = 'Confirmer', annuler = 'Annuler', danger = false }) {
    return new Promise((ok) => {
        let repondu = false;
        const rep = (v) => { if (!repondu) { repondu = true; ok(v); } };
        feuilleInfo({
            titre, texte,
            actions: [
                { label: confirmer, classe: danger ? 'btn-danger' : 'btn-plein', fn: () => rep(true) },
                { label: annuler, classe: 'btn-ghost', fn: () => rep(false) },
            ],
            // Voile touché, glissé, retour : c'est un « non ».
            surFermeture: () => rep(false),
        });
    });
}

/* ── état vide / erreur ───────────────────────────────────────────────────── */
export function etatHtml({ titre, texte = '', action = null, erreur = false }) {
    return `<div class="etat${erreur ? ' erreur' : ''}" role="${erreur ? 'alert' : 'status'}">
        ${erreur ? `<span class="ic">${IC.attention}</span>` : ANNEAUX}
        <div class="etat-titre">${esc(titre)}</div>
        ${texte ? `<p>${esc(texte)}</p>` : ''}
        ${action ? `<button class="btn btn-ghost" id="${esc(action.id)}" type="button">${esc(action.label)}</button>` : ''}
    </div>`;
}

/* ── squelettes ───────────────────────────────────────────────────────────── */
export function squeletteJournal(n = 2) {
    const jour = `<div class="squelette sq-jour"></div>
        <div class="duo">${['', ''].map(() => `<div><div class="squelette sq-photo"></div>
            <div class="squelette sq-ligne"></div></div>`).join('')}</div>`;
    return `<div aria-busy="true" aria-label="Chargement">${jour.repeat(n)}</div>`;
}
export function squeletteMedailles(n = 6) {
    return `<div class="medailles" aria-busy="true">${'<div><div class="squelette sq-sceau"></div></div>'.repeat(n)}</div>`;
}

/* ── l'emplacement d'un souvenir ──────────────────────────────────────────
   Quatre états, quatre formes :
     ouvert   la photo ; l'incrustation (l'autre prise) l'échange sur place,
              un appui sur la photo ouvre la fiche
     verrou   la vignette floutée du serveur — « À ouvrir » tant que je peux
              encore remplir ce jour-là, « Perdue » (inerte) sinon
     combler  MA journée, encore rattrapable : l'appui ouvre la capture
     vide     inerte : place de l'autre pas encore remplie, ou manquée

   @param qui        'sam' | 'alex' — la colonne
   @param p          le souvenir de cette personne ce jour-là, ou null
   @param ctx.day    le jour
   @param ctx.moi    le compte connecté
   @param ctx.ouvrable   ce jour m'est encore ouvert (aujourd'hui ou veille non remplie)
   @param ctx.aujourdhui le jour du serveur
   @param ctx.compact    version feuille (hauteur fixe, nom affiché)
   @param ctx.lieu       afficher le lieu sous la photo (journal) */
export function slotHtml(qui, p, ctx) {
    const { day, moi, ouvrable, aujourdhui, compact = false, lieu = true } = ctx;
    const cls = `slot ${classe(qui)}${compact ? ' compact' : ''}`;
    const nomHtml = compact ? `<span class="nom-encre">${esc(nom(qui))}</span>` : '';
    const lieuHtml = lieu && p?.location_label
        ? `<span class="lieu">${PIN}<span>${esc(p.location_label)}</span></span>` : '';

    if (p && p.unlocked) {
        const quand = dateJour(p.day || day);
        const fond = p.blur_photo_url ? ` style="background-image:url('${esc(p.blur_photo_url)}')"` : '';
        return `
        <div class="${cls} ouvert" data-post="${p.id}" role="button" tabindex="0"
             aria-label="Souvenir de ${esc(nom(qui))}, ${esc(quand)} — ouvrir">
            <div class="vue"${fond}>
                <img class="face charge" src="${esc(p.primary_photo_url)}" alt="Souvenir de ${esc(nom(qui))}, ${esc(quand)}" loading="lazy">
                <button class="incrust" type="button" data-flip aria-label="Voir l’autre prise">
                    <img class="dos" src="${esc(p.secondary_photo_url)}" alt="" loading="lazy">
                </button>
                ${p.is_catchup ? '<span class="tag">Rattrapée</span>' : ''}
            </div>
            <div class="dessous">
                ${nomHtml}
                ${compact ? '' : `<span class="heure">${esc(heureFr(p.created_at))}${filHtml(p)}</span>`}
                ${p.caption ? `<span class="mot">${esc(p.caption)}</span>` : ''}
                ${lieuHtml}
            </div>
        </div>`;
    }
    if (p) {
        const vignette = p.blur_photo_url ? `<img class="face" src="${esc(p.blur_photo_url)}" alt="" loading="lazy">` : '';
        const etiquette = ouvrable ? `${IC.cadenas}À ouvrir` : 'Perdue';
        return `
        <div class="${cls} verrou${ouvrable ? '' : ' perdue'}" data-verrou="${esc(p.day || day)}" data-auteur="${esc(qui)}"
             ${ouvrable ? `role="button" tabindex="0" aria-label="Souvenir de ${esc(nom(qui))}, à ouvrir"` : `aria-label="Souvenir de ${esc(nom(qui))}, journée perdue"`}>
            <div class="vue">${vignette}<span class="sceau">${etiquette}</span></div>
            <div class="dessous">
                ${nomHtml}
                ${compact ? '' : `<span class="heure">${esc(heureFr(p.created_at))}</span>`}
                ${lieuHtml}
            </div>
        </div>`;
    }
    if (qui === moi && ouvrable) {
        const quoi = day === aujourdhui ? 'Raconter ma journée' : 'Raconter hier';
        return `
        <div class="${cls} combler" data-combler="${esc(day)}" role="button" tabindex="0" aria-label="${quoi}">
            <div class="vue"><span class="plus">${IC.plus}</span></div>
            <div class="dessous">${nomHtml}<span class="heure">${day === aujourdhui ? 'À raconter' : 'À rattraper'}</span></div>
        </div>`;
    }
    // Vide : la mienne est manquée ; celle de l'autre n'est pas (encore) là.
    const mot = qui === moi ? 'Manquée' : (day === aujourdhui ? 'Pas encore' : '');
    return `
        <div class="${cls} vide">
            <div class="vue">${mot && day === aujourdhui && qui !== moi ? `<span class="attente">${mot}</span>` : ''}</div>
            <div class="dessous">${nomHtml}${mot && !(day === aujourdhui && qui !== moi)
                ? `<span class="heure">${mot}</span>` : ''}</div>
        </div>`;
}

/* Le fil sous un emplacement ouvert : le nombre de mots, et un repère plein
   quand l'autre en a écrit que je n'ai pas lus. Rien sans commentaire. */
let nonLusDe = () => 0;
export function brancheNonLus(fn) { nonLusDe = fn; }
function filHtml(p) {
    const n = p.comment_count || 0;
    const nouveaux = nonLusDe(p.id);
    if (!n && !nouveaux) return '';
    return `<span class="fil-n${nouveaux ? ' nonlu' : ''}"
        aria-label="${n} mot${n > 1 ? 's' : ''}${nouveaux ? ', dont des nouveaux' : ''}">${IC.bulle}${n}</span>`;
}

/** À appeler après avoir injecté des emplacements : fondu des photos une fois
 *  chargées (la vignette floue tient la place en attendant), incrustation qui
 *  échange les deux prises, clavier sur les emplacements-boutons. */
export function brancheSlots(racine, { ouvre, verrou, combler }) {
    racine.querySelectorAll('img.face.charge').forEach((img) => {
        const fini = () => img.classList.remove('charge');
        if (img.complete && img.naturalWidth) fini();
        else { img.addEventListener('load', fini, { once: true }); img.addEventListener('error', fini, { once: true }); }
    });
    racine.querySelectorAll('[data-flip]').forEach((b) => b.addEventListener('click', (e) => {
        // sans stopPropagation, l'appui traverserait jusqu'à la photo et
        // ouvrirait aussi la fiche
        e.stopPropagation();
        echangePrises(b.closest('.vue'));
    }));
    const active = (s, fn) => {
        s.addEventListener('click', () => fn(s));
        s.addEventListener('keydown', (e) => {
            if (e.target !== s) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(s); }
        });
    };
    if (ouvre) racine.querySelectorAll('.slot.ouvert[data-post]').forEach((s) => active(s, ouvre));
    if (verrou) racine.querySelectorAll('.slot.verrou:not(.perdue)').forEach((s) => active(s, verrou));
    if (combler) racine.querySelectorAll('[data-combler]').forEach((s) => active(s, combler));
}

/** Échange la grande photo et l'incrustation d'une scène, avec une courte
 *  bascule — sans elle, l'échange instantané passait inaperçu. */
export function echangePrises(scene) {
    const face = scene?.querySelector('.face, img.primary');
    const dos = scene?.querySelector('.incrust img');
    if (!face || !dos) return;
    [face.src, dos.src] = [dos.src, face.src];
    face.classList.remove('bascule-anim');
    void face.offsetWidth;
    face.classList.add('bascule-anim');
}
