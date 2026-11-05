// Formatage et échappement.
// esc() est OBLIGATOIRE sur tout HTML injecté : légendes et noms viennent de
// texte libre saisi par un utilisateur, donc non fiable.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** N'autorise que http(s). Bloque javascript:, data:, etc. */
export function safeUrl(u) {
    try {
        const url = new URL(String(u), window.location.origin);
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '#';
    } catch { return '#'; }
}

/** SQLite renvoie « 2026-09-21 09:12:03 » (UTC, sans marqueur de fuseau) :
 *  sans le Z ajouté ici, le navigateur l'interpréterait en heure locale et
 *  décalerait toutes les dates. */
function toDate(iso) {
    if (!iso) return null;
    let s = String(iso).trim().replace(' ', 'T');
    const aFuseau = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
    if (!aFuseau) s += 'Z';
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

export function ilYA(iso) {
    const d = toDate(iso);
    if (!d) return '';
    const j = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (j <= 0) return "aujourd’hui";
    if (j === 1) return 'hier';
    if (j < 31) return `il y a ${j} jours`;
    const m = Math.floor(j / 30);
    return m === 1 ? 'il y a un mois' : `il y a ${m} mois`;
}

export function heureFr(iso) {
    const d = toDate(iso);
    return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
}

export function dateFr(iso) {
    const d = toDate(iso);
    if (!d) return '';
    // « 1er octobre », jamais « 1 octobre » : toLocaleDateString ne le fait pas.
    const j = Number(d.toLocaleDateString('fr-FR', { day: 'numeric' }));
    const m = d.toLocaleDateString('fr-FR', { month: 'long' });
    return `${j === 1 ? '1er' : j} ${m}`;
}

/** Épingle de lieu en SVG : l'emoji 📍 dépend de la police installée et tombe
 *  en carré vide sur certains rendus. Ce libellé est lu partout, il ne doit
 *  jamais casser. */
export const PIN = '<svg class="pin" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/>'
    + '<circle cx="12" cy="10" r="2.6"/></svg>';

/* ── Le jour calendaire ────────────────────────────────────────────────────
   `day` vaut 'AAAA-MM-JJ' et vient DÉJÀ du serveur en heure de Paris. On le
   découpe à la main : `new Date('2026-09-22')` serait lu comme minuit UTC, et
   le 22 s'afficherait « 21 » pour tout fuseau à l'ouest de Greenwich. */
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

function pieces(day) {
    const [a, m, j] = String(day || '').split('-').map(Number);
    if (!a || !m || !j) return null;
    return { a, m, j, d: new Date(Date.UTC(a, m - 1, j)) };
}

export function jourNum(day) { return pieces(day)?.j ?? ''; }
/** « 1er octobre », « 2 octobre » — la date d'un jour, telle qu'on la lit. */
export function dateJour(day) {
    const p = pieces(day);
    return p ? `${p.j === 1 ? '1er' : p.j} ${MOIS[p.m - 1]}` : '';
}

export function jourMois(day) {
    const p = pieces(day);
    return p ? MOIS[p.m - 1] : '';
}

export function jourSemaine(day) {
    const p = pieces(day);
    return p ? JOURS[p.d.getUTCDay()] : '';
}

/** Le jour d'aujourd'hui vu du téléphone. Sert uniquement à écrire
 *  « aujourd'hui » ou « hier » : le serveur reste seul juge de ce qui est
 *  publiable, le téléphone peut être à l'heure d'un autre fuseau. */
export function jourLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        + `-${String(d.getDate()).padStart(2, '0')}`;
}

export function jourRelatif(day, aujourdhui) {
    const p = pieces(day);
    const r = pieces(aujourdhui || jourLocal());
    if (!p || !r) return '';
    const ecart = Math.round((r.d - p.d) / 86400000);
    if (ecart <= 0) return 'aujourd’hui';
    if (ecart === 1) return 'hier';
    if (ecart < 7) return `il y a ${ecart} jours`;
    return '';
}

/** Ce qu'il reste de la journée en cours.
 *
 *  Sert à dire QUAND une nouvelle photo redeviendra possible, sans afficher un
 *  compte à rebours au chiffre près : la barre qui se remplit porte l'essentiel
 *  du message, le texte ne donne qu'un ordre de grandeur.
 *
 *  Minuit est pris en heure LOCALE du téléphone : c'est la même que celle du
 *  serveur (Europe/Paris) pour les deux comptes, et c'est celle que lit
 *  l'utilisateur sur son écran. */
export function resteDeLaJournee() {
    const maintenant = new Date();
    const minuit = new Date(maintenant);
    minuit.setHours(24, 0, 0, 0);
    const restant = minuit - maintenant;
    const heures = Math.floor(restant / 3600000);
    return {
        fraction: Math.min(1, Math.max(0, 1 - restant / 86400000)),
        texte: heures >= 1 ? `${heures} h` : `${Math.max(1, Math.round(restant / 60000))} min`,
    };
}

/** Heure seule pour aujourd'hui, date + heure sinon — l'horodatage d'un
 *  commentaire, court comme dans une conversation. */
export function quandCourt(iso) {
    const d = toDate(iso);
    if (!d) return '';
    const auj = new Date();
    const memeJour = d.toDateString() === auj.toDateString();
    return memeJour ? heureFr(iso) : `${dateFr(iso)} · ${heureFr(iso)}`;
}
