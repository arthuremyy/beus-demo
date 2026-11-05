/* ============================================================================
   Le journal — une journée = un DIPTYQUE.

   Ce que remplace cette vue : une pile de photos pleine largeur, c'est-à-dire
   le format de flux le plus banal qui soit, et surtout un format qui ne dit
   rien de ce qu'est l'app. BeUs parle de DEUX personnes et d'une journée ;
   empiler leurs souvenirs l'un sous l'autre le cachait.

   Ici chaque journée occupe une ligne de deux emplacements, une encre chacun
   (rose = Sam, or = Alex). On lit d'un coup d'œil ce que l'autre a vu ce
   jour-là, et surtout ce qui MANQUE : un emplacement vide de son côté est une
   invitation, pas un trou dans une liste.

   Quatre états par emplacement, quatre formes distinctes :

     · ouvert     — la photo, avec DEUX gestes distincts et séparés :
                    l'incrustation (l'autre prise, en petit dans le coin, le
                    code BeReal) la RETOURNE sur place ; un appui sur la photo
                    elle-même l'ouvre en grand. Les mélanger rendait l'appui
                    ambigu — on ne savait pas si on allait agrandir ou retourner.
     · verrouillé — la vignette floutée fabriquée au serveur. Visible exprès :
                    sans elle, rien n'indique qu'il y a quelque chose à ouvrir.
                    Deux sous-états, et la différence compte : « à ouvrir »
                    tant que je peux encore remplir ce jour-là, « perdue »
                    quand la journée est close — car le déblocage se fait par
                    jour, et une journée close ne se rouvrira jamais.
     · à combler  — MA journée manquée, encore dans la fenêtre de rattrapage
                    (la veille, pas plus). L'appui ouvre la capture sur ce jour.
     · vide       — journée close de mon côté (« Manquée »), ou place de
                    l'autre pas encore remplie (« Pas encore »).

   Le rendu d'un emplacement est COMMUN avec la feuille de carte et l'écran
   « journée déjà racontée » : composants.js → slotHtml.
   ========================================================================== */
import { api } from '../api.js';
import { esc, jourMois, jourNum, jourRelatif, jourSemaine, resteDeLaJournee } from '../fmt.js';
import { showDetail, expliqueVerrou } from '../ui.js';
import { toast, slotHtml, brancheSlots, etatHtml, squeletteJournal } from '../composants.js';
import { ANNEAUX } from '../icones.js';
import { getSession, prendPostAOuvrir, prendJourAMontrer } from '../state.js';
import { journalVu } from '../nouveautes.js';
import { ORDRE, nom, classe } from '../personnes.js';

const LIMIT = 24;
// Au-delà, revenir sur l'onglet recharge le journal : sans ça, le souvenir que
// l'autre venait de publier n'apparaissait qu'après un rechargement complet.
const FRAICHEUR_MS = 60 * 1000;

let items = [];
let curseur = null;   // { before_day, before_id } — le flux est classé par jour
let loading = false;
let chargePour = null;   // le compte dont le journal est en mémoire
let jours = null;        // réponse de GET /jours
let chargeA = 0;         // horodatage du dernier chargement complet
let serie = 0;           // jours d'affilée remplis par les deux (GET /stats)
let echos = [];          // souvenirs d'il y a un mois / un an (GET /souvenirs/echo)
let observateur = null;  // chargement continu au bas de la page

function el() { return document.getElementById('view-feed'); }

/* ── une journée ─────────────────────────────────────────────────────────── */

const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/* La surimpression : deux anneaux croisés, à la couleur des deux. C'est le
   SEUL endroit du journal où elle apparaît, et elle ne veut dire qu'une chose :
   cette journée, vous l'avez remplie tous les deux. */
const A_DEUX = `<svg class="a-deux" viewBox="0 0 24 16" role="img" aria-label="Remplie à deux">
    <circle cx="8" cy="8" r="6.2"/><circle cx="16" cy="8" r="6.2"/></svg>`;

/* « 2 octobre · aujourd'hui » : le mois reste collé à son numéro, le relatif
   (ou le jour de la semaine) vient après. */
function enteteJour(day, encres, aujourdhui) {
    const quoi = jourRelatif(day, aujourdhui) || jourSemaine(day);
    const premier = jourNum(day) === 1 ? '<sup>er</sup>' : '';
    return `
        <h2 class="jour" data-jour="${esc(day)}">
            <span class="num disp">${esc(String(jourNum(day)))}${premier}</span>
            <span class="mois">${esc(jourMois(day))}</span>
            <span class="quoi">· ${esc(quoi)}</span>
            ${encres.size === 2 ? A_DEUX : ''}
        </h2>`;
}

function journeeHtml(day, duJour, moi, aujourdhui, ouvrable) {
    const parAuteur = Object.fromEntries(duJour.map((p) => [p.author_id, p]));
    const encres = new Set(duJour.map((p) => p.author_id));
    const colonnes = ORDRE.map((qui) => slotHtml(qui, parAuteur[qui] || null,
        { day, moi, ouvrable, aujourdhui })).join('');
    // Une journée SANS aucune photo se replie : à pleine hauteur elle mangeait
    // un écran entier pour ne rien montrer.
    const creuse = duJour.length === 0;
    return `
        ${enteteJour(day, encres, aujourdhui)}
        <div class="duo${creuse ? ' creuse' : ''}">${colonnes}</div>`;
}

/* ── en tête ─────────────────────────────────────────────────────────────── */

/* Sous le titre, une seule ligne : la série (sous deux jours, une « série »
   n'en est pas une) et, une fois ma journée racontée, ce qu'il en reste. Le
   compte à rebours n'existe qu'ici. */
function peintSousTitre() {
    const morceaux = [];
    if (serie >= 2) morceaux.push(`${serie} jours d’affilée à deux`);
    if (jours?.aujourdhui_rempli) morceaux.push(`nouvelle journée dans ${resteDeLaJournee().texte}`);
    const t = morceaux.join(' · ');
    document.getElementById('feed-sous').textContent = t ? majuscule(t) : '';
}

const QUAND = { mois: 'Il y a un mois', an: 'Il y a un an' };

function echoHtml() {
    if (!echos.length) return '';
    const groupes = ['an', 'mois'].filter((q) => echos.some((e) => e.quand === q));
    return groupes.map((q) => `
        <div class="echo">
            <div class="echo-titre">${esc(QUAND[q])}</div>
            <div class="echo-vignettes">${echos.filter((e) => e.quand === q).map((e) => `
                <button class="echo-v ${classe(e.author_id)}" type="button" data-echo="${e.id}"
                        aria-label="${esc(nom(e.author_id))}, ${esc(QUAND[q].toLowerCase())}">
                    <img src="${esc(e.primary_photo_url)}" alt="" loading="lazy">
                </button>`).join('')}
            </div>
        </div>`).join('');
}

/* ── rendu ───────────────────────────────────────────────────────────────── */

function renderList() {
    const scroll = el().querySelector('.scroll');
    const garde = scroll.scrollTop;   // un re-rendu (nouveau mot) ne doit pas remonter en haut
    const moi = getSession()?.user_id ?? null;

    if (!items.length && !(jours?.a_combler || []).length && jours?.aujourdhui_rempli !== false) {
        scroll.innerHTML = etatHtml({ titre: 'Rien encore',
            texte: 'Un souvenir par jour. Le sien s’ouvrira quand tu auras raconté le tien.',
            action: { id: 'feed-vide-capture', label: 'Raconter ma journée' } });
        scroll.querySelector('#feed-vide-capture').addEventListener('click', () =>
            document.dispatchEvent(new CustomEvent('beus-combler', { detail: { day: null } })));
        return;
    }

    const parJour = new Map();
    for (const p of items) {
        if (!p.day) continue;
        if (!parJour.has(p.day)) parJour.set(p.day, []);
        parJour.get(p.day).push(p);
    }

    // Les jours qui me sont encore ouverts : la veille non remplie et, tant
    // que je ne l'ai pas racontée, aujourd'hui.
    const ouverts = new Set(jours?.a_combler || []);
    const aujourdhui = jours?.aujourdhui;
    if (aujourdhui && !jours?.aujourdhui_rempli) ouverts.add(aujourdhui);

    /* Les jours ouverts plus anciens que ce qui est chargé attendent la page
       suivante — SAUF quand tout est chargé (curseur nul). */
    const plusAncienCharge = items[items.length - 1]?.day;
    const journees = [...new Set([
        ...parJour.keys(),
        ...(aujourdhui ? [aujourdhui] : []),
        ...[...ouverts].filter((d) => !curseur || !plusAncienCharge || d >= plusAncienCharge),
    ])].sort().reverse();

    peintSousTitre();
    // Les noms de colonnes ne sont écrits QU'UNE FOIS, collés en haut.
    scroll.innerHTML = `<div class="tirer" aria-hidden="true">${ANNEAUX}</div>` + echoHtml()
        + `<div class="duo-tete">${ORDRE.map((qui) =>
            `<span class="nom-encre ${classe(qui)}">${esc(nom(qui))}</span>`).join('')}</div>`
        + journees.map((d) => journeeHtml(d, parJour.get(d) || [], moi, aujourdhui, ouverts.has(d))).join('')
        + (curseur ? '<div class="suite" aria-hidden="true"></div><button class="btn btn-ghost load-more" id="feed-more">Jours précédents</button>' : '');

    brancheSlots(scroll, {
        ouvre: (s) => {
            const post = items.find((p) => String(p.id) === s.dataset.post);
            if (post) showDetail(post, esc);
        },
        verrou: (s) => {
            const post = items.find((p) => p.day === s.dataset.verrou && p.author_id === s.dataset.auteur);
            if (post) expliqueVerrou(post, { aujourdhui });
        },
        combler: (s) => document.dispatchEvent(new CustomEvent('beus-combler',
            { detail: { day: s.dataset.combler === aujourdhui ? null : s.dataset.combler } })),
    });
    scroll.querySelectorAll('[data-echo]').forEach((b) => b.addEventListener('click', () => {
        const p = echos.find((x) => String(x.id) === b.dataset.echo);
        if (p) showDetail(p, esc);
    }));
    document.getElementById('feed-more')?.addEventListener('click', loadMore);
    observeSuite(scroll);
    scroll.scrollTop = garde;
}

/* Chargement continu : la page suivante part quand le bas approche. Le
   bouton reste, en secours (pas d'IntersectionObserver, réseau lent). */
function observeSuite(scroll) {
    observateur?.disconnect();
    const suite = scroll.querySelector('.suite');
    if (!suite || !('IntersectionObserver' in window)) return;
    observateur = new IntersectionObserver((entrees) => {
        if (entrees.some((e) => e.isIntersecting)) loadMore();
    }, { root: scroll, rootMargin: '600px 0px' });
    observateur.observe(suite);
}

async function loadMore() {
    if (loading) return;
    loading = true;
    try {
        const res = await api.post('/posts/feed', { ...(curseur || {}), limit: LIMIT });
        items = items.concat(res.posts);
        curseur = res.next_before_id
            ? { before_day: res.next_before_day, before_id: res.next_before_id }
            : null;
        renderList();
    } catch {
        if (!items.length) {
            const scroll = el().querySelector('.scroll');
            scroll.innerHTML = etatHtml({ titre: 'Le journal n’a pas pu se charger',
                texte: 'Vérifie la connexion.', action: { id: 'feed-reessayer', label: 'Réessayer' }, erreur: true });
            scroll.querySelector('#feed-reessayer').addEventListener('click', () => render({ force: true }));
        } else toast('Les jours précédents n’ont pas pu se charger', { erreur: true });
    } finally {
        loading = false;
    }
}

/** Rechargement complet — après une publication, le nouveau souvenir et ceux
 *  qu'il vient d'ouvrir doivent apparaître sans recharger la page. */
export function reset() {
    items = []; curseur = null; chargePour = null; jours = null; chargeA = 0;
    serie = 0; echos = [];
}

function actif() { return el().classList.contains('active'); }

/** Une journée demandée depuis la carte (#/feed?d=AAAA-MM-JJ) : on charge
 *  jusqu'à elle si besoin (quelques pages au plus), puis on s'y place. */
async function montreJour() {
    const d = prendJourAMontrer();
    if (!d) return;
    for (let i = 0; i < 6 && curseur && !items.some((p) => p.day <= d); i++) await loadMore();
    const cible = el().querySelector(`.jour[data-jour="${d}"]`);
    if (!cible) return;
    const scroll = el().querySelector('.scroll');
    const tete = el().querySelector('.duo-tete')?.offsetHeight || 0;
    scroll.scrollTop = cible.offsetTop - tete - 8;
}

/* Tirer pour rafraîchir, tout en haut du journal : les deux anneaux
   apparaissent, puis tournent pendant la recharge. */
function brancheTirer() {
    const scroll = el().querySelector('.scroll');
    if (scroll.dataset.tirer) return;
    scroll.dataset.tirer = '1';
    let y0 = null;
    let dy = 0;
    scroll.addEventListener('touchstart', (e) => {
        y0 = scroll.scrollTop <= 0 ? e.touches[0].clientY : null;
        dy = 0;
    }, { passive: true });
    scroll.addEventListener('touchmove', (e) => {
        if (y0 == null) return;
        dy = Math.max(0, e.touches[0].clientY - y0);
        const t = scroll.querySelector('.tirer');
        if (t) { t.style.height = `${Math.min(dy * 0.5, 56)}px`; t.classList.toggle('pret', dy > 90); }
    }, { passive: true });
    scroll.addEventListener('touchend', () => {
        const t = scroll.querySelector('.tirer');
        if (t) t.style.height = '';
        if (y0 != null && dy > 90 && !loading) {
            t?.classList.add('charge');
            render({ force: true, garde: true });
        }
        y0 = null;
    });
}

/** Un souvenir demandé par une notification (#/feed?p=ID) : on l'ouvre s'il
 *  est chargé, sinon on le demande — le serveur refuse s'il est verrouillé. */
async function ouvreDemande() {
    const id = prendPostAOuvrir();
    if (!id) return;
    let post = items.find((p) => String(p.id) === String(id) && p.unlocked);
    if (!post) {
        try { post = await api.get(`/posts/${id}`); } catch (e) {
            if (e.status === 403) {
                // Verrouillé pour moi : l'explication, avec l'action qui l'ouvre.
                const p = items.find((x) => String(x.id) === String(id));
                if (p) expliqueVerrou(p, { aujourdhui: jours?.aujourdhui });
                else toast('Raconte ta journée pour ouvrir ce souvenir');
            } else toast('Ce souvenir n’existe plus', { erreur: true });
            return;
        }
    }
    showDetail(post, esc);
}

export async function render({ force = false, garde = false } = {}) {
    // Le cache est indexé par compte : sans ça, se connecter avec l'autre
    // compte sans recharger la page laissait à l'écran les souvenirs du
    // précédent — la règle de déblocage était contournée côté client alors que
    // le serveur, lui, répondait correctement.
    const moi = getSession()?.user_id ?? null;
    brancheTirer();
    const frais = Date.now() - chargeA < FRAICHEUR_MS;
    if (!force && chargePour === moi && frais) {
        renderList();           // repères « non lu » à jour, sans requête
        journalVu();
        await montreJour();
        await ouvreDemande();
        return;
    }
    const premier = chargePour !== moi || !items.length;
    reset();
    chargePour = moi;
    if (premier && !garde) el().querySelector('.scroll').innerHTML = squeletteJournal(2);
    const [j, st, ec] = await Promise.all([
        api.get('/jours').catch(() => null),
        api.get('/stats').catch(() => null),
        api.get('/souvenirs/echo').catch(() => null),
    ]);
    jours = j;
    serie = st?.serie || 0;
    echos = ec?.souvenirs || [];
    await loadMore();
    chargeA = Date.now();
    if (chargePour !== moi) return;
    journalVu();
    await montreJour();
    await ouvreDemande();
}

/* Retour dans l'app (téléphone déverrouillé, app rouverte) : si le journal
   est à l'écran et qu'il a vieilli, on le recharge. */
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && actif() && getSession()
        && Date.now() - chargeA >= FRAICHEUR_MS) render({ force: true });
});
// Un mot écrit ou lu depuis la fiche : on redessine les compteurs sur place.
document.addEventListener('beus-post-maj', (e) => {
    const maj = e.detail?.post;
    const p = maj && items.find((x) => x.id === maj.id);
    if (p && p !== maj) Object.assign(p, { comment_count: maj.comment_count, caption: maj.caption });
    if (actif()) renderList();
});
document.addEventListener('beus-fil-lu', () => { if (actif()) renderList(); });
// Nouveau souvenir de l'autre signalé par la pastille : recharge si visible.
document.addEventListener('beus-nouveautes', (e) => {
    if (actif() && e.detail?.nouveaux_souvenirs && !loading) render({ force: true });
    else if (actif()) renderList();
});
