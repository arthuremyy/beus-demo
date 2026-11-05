// État partagé minimal entre vues (évite les imports circulaires avec main.js).
import { jourLocal } from './fmt.js';
let session = null;
let pendingCapture = null; // { primaryBlob, secondaryBlob, primaryFacing, lat, lng }

export function setSession(s) {
    session = s;
    document.body.classList.toggle('is-admin', !!s?.is_admin);
}
export function getSession() { return session; }
export function clearSession() {
    session = null;
    document.body.classList.remove('is-admin');
}

/* Le jour que la capture en cours vient combler. null = aujourd'hui.
   Il traverse capture -> révision -> publication : c'est lui qui part dans le
   champ `day`, et le serveur reste seul juge de sa validité. */
let jourVise = null;

/* Journée à montrer dans le journal (« voir dans le journal » depuis la
   feuille de la carte). Prise une seule fois. */
let jourAMontrer = null;
export function setJourAMontrer(d) { jourAMontrer = d || null; }
export function prendJourAMontrer() { const d = jourAMontrer; jourAMontrer = null; return d; }
export function setJourVise(j) { jourVise = j || null; }
export function getJourVise() { return jourVise; }

/* La capture en attente est AUSSI gardée dans IndexedDB : un rechargement
   (appel entrant, app tuée par iOS, réseau perdu à la publication) faisait
   perdre les deux photos. Elle porte son compte — sur un téléphone partagé,
   l'autre ne doit jamais publier la photo du premier — et son jour de prise :
   une photo d'hier restaurée aujourd'hui est publiée SUR hier (le serveur
   refuse si la fenêtre est passée). Toute erreur IndexedDB est silencieuse :
   sans stockage, on retombe sur l'ancien comportement (mémoire seule). */
const IDB_NOM = 'beus', IDB_MAGASIN = 'capture', IDB_CLE = 'courante';

function ouvreIdb() {
    return new Promise((ok, ko) => {
        const r = indexedDB.open(IDB_NOM, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(IDB_MAGASIN);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
    });
}

async function idb(mode, geste) {
    const base = await ouvreIdb();
    return new Promise((ok, ko) => {
        const tx = base.transaction(IDB_MAGASIN, mode);
        const req = geste(tx.objectStore(IDB_MAGASIN));
        tx.oncomplete = () => { base.close(); ok(req?.result); };
        tx.onerror = () => { base.close(); ko(tx.error); };
    });
}

export function setPendingCapture(c) {
    // Le jour de prise voyage avec la capture, même en mémoire : une photo prise
    // à 23 h 58 et publiée à 0 h 01 doit partir sur la veille.
    pendingCapture = { ...c, prisLe: c.prisLe || jourLocal() };
    const trace = { ...pendingCapture, user: session?.user_id ?? null, jourVise };
    idb('readwrite', (st) => st.put(trace, IDB_CLE)).catch(() => {});
}
export function getPendingCapture() { return pendingCapture; }
export function clearPendingCapture() {
    pendingCapture = null;
    jourVise = null;
    idb('readwrite', (st) => st.delete(IDB_CLE)).catch(() => {});
}

/** Restaure la capture gardée, si elle appartient au compte connecté. */
export async function restoreCapture() {
    if (pendingCapture) return pendingCapture;
    let c = null;
    try { c = await idb('readonly', (st) => st.get(IDB_CLE)); } catch { return null; }
    if (!c || !c.primaryBlob || !c.secondaryBlob || c.user !== (session?.user_id ?? null)) return null;
    pendingCapture = c;
    jourVise = c.jourVise || (c.prisLe && c.prisLe !== jourLocal() ? c.prisLe : null);
    return c;
}

export async function captureEnAttente() { return !!(await restoreCapture()); }

/* Un souvenir à ouvrir dès que le journal est prêt — posé par un lien
   #/feed?p=ID (clic sur une notification), consommé une seule fois. */
let postAOuvrir = null;
export function setPostAOuvrir(id) { postAOuvrir = id || null; }
export function prendPostAOuvrir() { const id = postAOuvrir; postAOuvrir = null; return id; }
