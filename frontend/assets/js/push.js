/* Abonnement de CET appareil aux notifications (services/push.py côté serveur).

   Sur iPhone, le Web Push n'existe que pour une app ajoutée à l'écran
   d'accueil et ouverte depuis son icône (iOS ≥ 16.4). Dans Safari « normal »,
   PushManager est absent : on explique alors comment installer l'app plutôt
   que d'afficher un bouton qui ne ferait rien.

   L'abonnement suit le COMPTE connecté : à la déconnexion on le retire, pour
   que le téléphone d'Alex ne reçoive pas les notifications de Sam après
   qu'elle s'y est connectée un moment. */
import { api } from './api.js';

const estIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const installee = () => window.matchMedia?.('(display-mode: standalone)').matches
    || navigator.standalone === true;

export function supporte() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Ce que le profil doit afficher : 'installer' | 'indisponible' | 'serveur'
 *  | 'refuse' | 'actif' | 'inactif'. */
export async function etat() {
    if (!supporte()) return estIOS() && !installee() ? 'installer' : 'indisponible';
    let cle;
    try { cle = await api.get('/push/cle'); } catch { return 'indisponible'; }
    if (!cle.actif) return 'serveur';
    if (Notification.permission === 'denied') return 'refuse';
    const sub = await abonnementCourant();
    return sub ? 'actif' : 'inactif';
}

async function abonnementCourant() {
    try {
        const reg = await navigator.serviceWorker.ready;
        return await reg.pushManager.getSubscription();
    } catch { return null; }
}

function cleBinaire(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const brut = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}

async function envoie(sub) {
    const j = sub.toJSON();
    await api.post('/push/abonnement', { endpoint: j.endpoint, keys: j.keys });
}

/** À appeler depuis un GESTE de l'utilisateur : iOS refuse la demande
 *  d'autorisation autrement. */
export async function activer() {
    const { cle } = await api.get('/push/cle');
    if (!cle) throw new Error('Notifications non configurées sur le serveur');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Autorisation refusée');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription()
        || await reg.pushManager.subscribe({ userVisibleOnly: true,
                                             applicationServerKey: cleBinaire(cle) });
    await envoie(sub);
}

export async function desactiver() {
    const sub = await abonnementCourant();
    if (!sub) return;
    try { await api.post('/push/desabonnement', { endpoint: sub.endpoint }); } catch { /* ignore */ }
    try { await sub.unsubscribe(); } catch { /* ignore */ }
}

/** Au démarrage : un abonnement existant est ré-annoncé au serveur (il a pu
 *  être purgé, ou le compte connecté a changé). */
export async function resynchronise() {
    if (!supporte()) return;
    const sub = await abonnementCourant();
    if (sub) { try { await envoie(sub); } catch { /* hors ligne */ } }
}

export function enregistre() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sans SW : pas de push */ });
}
