/* La pastille : ce qui est nouveau pour moi depuis la dernière fois.

   Source unique : GET /nouveautes (commentaires non lus de l'autre, sur des
   souvenirs OUVERTS ; souvenirs de l'autre pas encore vus). On l'interroge au
   démarrage, au retour dans l'app, après chaque action, et toutes les minutes
   tant que l'app est à l'écran. Pas de temps réel : à deux, c'est suffisant. */
import { api } from './api.js';
import { getSession } from './state.js';

const VIDE = { commentaires_non_lus: 0, par_post: {}, nouveaux_souvenirs: 0 };
let etat = VIDE;
let minuteur = null;

export function courant() { return etat; }
export function nonLus(postId) { return etat.par_post?.[String(postId)] || 0; }

function peint() {
    const n = (etat.commentaires_non_lus || 0) + (etat.nouveaux_souvenirs || 0);
    const onglet = document.querySelector('#nav button[data-tab="feed"]');
    if (onglet) {
        onglet.classList.toggle('pastille', n > 0);
        onglet.setAttribute('aria-label', n > 0 ? `Journal, ${n} nouveauté${n > 1 ? 's' : ''}` : 'Journal');
    }
    // Le chiffre sur l'icône de l'écran d'accueil (app installée seulement).
    try {
        if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
        else navigator.clearAppBadge?.()?.catch?.(() => {});
    } catch { /* non géré */ }
}

export async function rafraichit() {
    if (!getSession()) { etat = VIDE; peint(); return etat; }
    try { etat = await api.get('/nouveautes'); } catch { return etat; }
    peint();
    document.dispatchEvent(new CustomEvent('beus-nouveautes', { detail: etat }));
    return etat;
}

/** Le journal vient d'être affiché : les souvenirs de l'autre sont vus. */
export async function journalVu() {
    if (!etat.nouveaux_souvenirs) return;
    try { await api.post('/nouveautes/journal-vu'); } catch { return; }
    etat = { ...etat, nouveaux_souvenirs: 0 };
    peint();
}

/** Un fil vient d'être lu (GET /comments le marque côté serveur). */
export function filLu(postId) {
    const n = nonLus(postId);
    if (!n) return;
    const par_post = { ...etat.par_post };
    delete par_post[String(postId)];
    etat = { ...etat, par_post, commentaires_non_lus: Math.max(0, etat.commentaires_non_lus - n) };
    peint();
}

export function reinitialise() { etat = VIDE; peint(); }

export function demarre() {
    rafraichit();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rafraichit(); });
    clearInterval(minuteur);
    minuteur = setInterval(() => { if (!document.hidden) rafraichit(); }, 60000);
}
