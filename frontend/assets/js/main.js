// Amorçage et routeur par hash. Modules ES natifs, MapLibre en CDN, aucun bundler.
import { api, setUnauthorizedHandler } from './api.js';
import { setSession, clearSession, getSession, setJourVise, setPostAOuvrir, setJourAMontrer,
         captureEnAttente } from './state.js';
import * as nouveautes from './nouveautes.js';
import * as push from './push.js';
import { fete } from './fete.js';
import { hideDetail, hideFeuille, fermeFiche, fermeFeuille, peintMoi } from './ui.js';
import { toast, brancheNonLus } from './composants.js';
import { IC, peintIcones } from './icones.js';
import { accueilSiPremiereFois, momentPublication } from './moments.js';
import * as login from './views/login.js';
import * as mapView from './views/map.js';
import * as feed from './views/feed.js';
import * as capture from './views/capture.js';
import * as review from './views/review.js';
import * as admin from './views/admin.js';
import * as profile from './views/profile.js';
import * as settings from './views/settings.js';

const VUES = { login, map: mapView, feed, capture, review, admin, profile, settings };
const PUBLIC_VIEWS = new Set(['login']);
// Vues plein écran : ni barre du bas, ni bandeau de carte.
const SANS_CHROME = ['login', 'capture', 'review'];
// Vues « poussées » : pas des onglets, elles ont un retour (chevron à gauche).
const POUSSEES = ['profile', 'settings', 'admin'];
// D'où revient chaque écran poussé. Le profil revient à l'onglet d'origine.
const PARENT = { settings: 'profile', admin: 'settings' };
let activeTab = null;
let depuis = 'map';     // l'onglet d'où l'on a ouvert le profil

/* Le hash peut porter une demande : #/feed?p=12 (clic sur une notification)
   ouvre le souvenir 12 dès que le journal est chargé. */
function currentTab() {
    const [onglet, requete] = window.location.hash.replace('#/', '').split('?');
    const p = new URLSearchParams(requete || '').get('p');
    if (p && /^\d+$/.test(p)) setPostAOuvrir(p);
    const d = new URLSearchParams(requete || '').get('d');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setJourAMontrer(d);
    return onglet || (getSession() ? 'map' : 'login');
}

function aller(onglet) {
    if (!VUES[onglet]) onglet = getSession() ? 'map' : 'login';
    if (!PUBLIC_VIEWS.has(onglet) && !getSession()) onglet = 'login';
    if (onglet === 'admin' && !getSession()?.is_admin) onglet = 'map';

    const precedent = activeTab;
    if (precedent && precedent !== onglet) VUES[precedent]?.teardown?.();
    if (precedent && !POUSSEES.includes(precedent) && !SANS_CHROME.includes(precedent)) depuis = precedent;
    activeTab = onglet;
    hideDetail();
    hideFeuille();

    document.querySelectorAll('#nav button[data-tab]').forEach((b) =>
        b.setAttribute('aria-current', String(b.dataset.tab === onglet)));
    document.querySelectorAll('.view').forEach((v) => {
        const cible = v.id === `view-${onglet}`;
        v.classList.toggle('active', cible);
        v.classList.remove('entre-pousse', 'entre-onglet');
        // Un écran poussé arrive de la droite ; un onglet, en fondu.
        if (cible && precedent && precedent !== onglet) {
            v.classList.add(POUSSEES.includes(onglet) && !POUSSEES.includes(precedent) ? 'entre-pousse'
                : POUSSEES.includes(onglet) && POUSSEES.indexOf(onglet) > POUSSEES.indexOf(precedent) ? 'entre-pousse'
                : 'entre-onglet');
        }
    });

    const sansNav = SANS_CHROME.includes(onglet) || POUSSEES.includes(onglet);
    document.getElementById('nav').hidden = sansNav;
    document.body.classList.toggle('sans-nav', sansNav);
    // Le bandeau de la carte vit hors de #app : la vue carte le montre elle-même
    // quand son message est prêt — jamais vide.
    if (onglet !== 'map') document.getElementById('map-hud').hidden = true;

    history.replaceState(history.state, '', `#/${onglet}`);
    VUES[onglet].render();
}

function global() {
    peintIcones();
    document.querySelectorAll('#nav button[data-tab]').forEach((b) =>
        b.addEventListener('click', () => { window.location.hash = `#/${b.dataset.tab}`; }));
    document.getElementById('nav-capture').addEventListener('click', () => {
        setJourVise(null);           // le bouton principal vise toujours aujourd'hui
        window.location.hash = '#/capture';
    });
    document.querySelectorAll('[data-moi]').forEach((b) =>
        b.addEventListener('click', () => { window.location.hash = '#/profile'; }));
    document.querySelectorAll('[data-retour]').forEach((b) =>
        b.addEventListener('click', () => {
            window.location.hash = `#/${PARENT[activeTab] || depuis}`;
        }));
    document.getElementById('vers-reglages').addEventListener('click', () => {
        window.location.hash = '#/settings';
    });
    // « Raconter » un jour précis (journal, feuille, explication d'un verrou).
    // day null = aujourd'hui.
    document.addEventListener('beus-combler', (e) => {
        setJourVise(e.detail?.day || null);
        window.location.hash = '#/capture';
    });
    // Le bouton vit dans les réglages, redessinés à chaque passage : délégation.
    document.addEventListener('click', async (e) => {
        if (!e.target.closest('#logout-btn')) return;
        // L'abonnement aux notifications suit le compte : le téléphone ne doit
        // plus rien recevoir pour celui qui se déconnecte.
        try { await push.desactiver(); } catch { /* ignore */ }
        try { await api.post('/auth/logout'); } catch { /* ignore */ }
        clearSession();
        // Rechargement COMPLET : l'app est à deux comptes sur le même
        // téléphone. Vider la session en mémoire ne suffit pas — photos déjà
        // rendues, caches de vues, capture en attente resteraient à l'écran.
        window.location.replace('/');
    });
    window.addEventListener('hashchange', () => aller(currentTab()));
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.voile-feuille')) return;
        fermeFiche(); fermeFeuille();
    });
    // Après publication : le flux doit repartir de zéro, sinon le nouveau
    // souvenir (et ceux qu'il vient de débloquer) n'apparaissent pas.
    document.addEventListener('beus-published', (e) => {
        feed.reset();
        profile.reset();   // les médailles viennent peut-être de changer
        majCapture();
        nouveautes.rafraichit();
        if (e.detail?.id) {
            momentPublication({ deux: !!e.detail.deux, rattrapage: !!e.detail.is_catchup });
            setTimeout(fete, 1900);   // la médaille passe après le moment
        } else fete();
    });
    // Connexion sans rechargement (écran de login) : pastille et abonnement
    // repartent pour le nouveau compte.
    document.addEventListener('beus-session', async () => {
        nouveautes.rafraichit();
        push.resynchronise();
        peintMoi();
        majCapture();
        await accueilSiPremiereFois();
        fete();
    });
    // Retour dans l'app : une médaille de couple a pu tomber entre-temps.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) fete(); });
    // Clic sur une notification alors que l'app était déjà ouverte.
    navigator.serviceWorker?.addEventListener('message', (e) => {
        if (e.data?.type !== 'beus-ouvre' || typeof e.data.url !== 'string') return;
        const hash = e.data.url.split('#')[1];
        if (hash && hash.startsWith('/')) window.location.hash = hash;
    });
    // Hors ligne : une ligne discrète en haut, tant que ça dure.
    const reseau = () => {
        const b = document.getElementById('hors-ligne');
        b.innerHTML = `${IC.horsLigne}<span>Hors ligne</span>`;
        b.hidden = navigator.onLine !== false;
    };
    window.addEventListener('online', reseau);
    window.addEventListener('offline', reseau);
    reseau();
}

/* Le déclencheur central change d'état quand la journée est déjà racontée :
   il reste là (il mène à la journée du jour et au rattrapage) mais il cesse
   de réclamer. Une seule requête, au chargement et après publication. */
async function majCapture() {
    const b = document.getElementById('nav-capture');
    if (!getSession()) return;
    try {
        const j = await api.get('/jours');
        b.classList.toggle('fait', !!j.aujourdhui_rempli);
        b.setAttribute('aria-label',
            j.aujourdhui_rempli ? 'Ta journée est racontée' : 'Raconter ma journée');
    } catch { /* sans réponse, on laisse le bouton en état normal */ }
}

async function boot() {
    brancheNonLus(nouveautes.nonLus);
    setUnauthorizedHandler(() => {
        // Une session qui existait et qui tombe : on le dit sur l'écran de
        // connexion. Au premier chargement sans cookie, rien à dire.
        if (getSession()) login.sessionExpiree(getSession().user_id);
        clearSession();
        window.location.hash = '#/login';
        aller('login');
    });
    global();
    try {
        const me = await api.get('/auth/me');
        setSession(me);
    } catch { /* pas connecté */ }
    peintMoi();
    aller(currentTab());
    majCapture();
    push.enregistre();
    nouveautes.demarre();
    if (getSession()) {
        push.resynchronise();
        await accueilSiPremiereFois();
        fete();
        // Une photo prise puis perdue par un rechargement attend encore.
        if (currentTab() !== 'review' && await captureEnAttente()) {
            toast('Une photo attend d’être publiée');
            window.location.hash = '#/review';
        }
    }
}

boot();
