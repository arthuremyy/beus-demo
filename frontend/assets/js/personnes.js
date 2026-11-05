/* Les deux personnes de l'app — la SEULE source de leur nom, de leur ordre et
   de leur encre côté JS. L'encre elle-même (quelle couleur) se décide dans
   style.css (--encre-sam / --encre-alex) : ici on ne fait que la nommer.

   L'ORDRE est fixe partout (connexion, journal, feuilles, bascule du profil) :
   Sam à gauche, Alex à droite — comme le logo, Be (Sam) Us (Alex). */
export const ORDRE = ['sam', 'alex'];
export const NOMS = { sam: 'Sam', alex: 'Alex' };

export const nom = (qui) => NOMS[qui] || qui || '';
/** La valeur CSS de l'encre d'une personne, pour --encre-auteur. */
export const encre = (qui) => `var(--encre-${qui === 'alex' ? 'alex' : 'sam'})`;
/** La classe qui pose --encre-auteur (p-sam / p-alex). */
export const classe = (qui) => (qui === 'alex' ? 'p-alex' : 'p-sam');
export const autre = (qui) => ORDRE.find((q) => q !== qui) || null;
/** Trie une liste d'objets portant `id` (ou `author_id`) dans l'ordre fixe. */
export const ordonne = (liste, cle = 'id') =>
    [...liste].sort((a, b) => ORDRE.indexOf(a[cle]) - ORDRE.indexOf(b[cle]));

/* ── les visages ──────────────────────────────────────────────────────────
   L'adresse de l'avatar de chacun (versionnée par le serveur), chargée une
   fois depuis /auth/accounts (public) et tenue à jour après un envoi. Sans
   photo : null, et l'interface retombe sur l'initiale à l'encre de la personne. */
const avatars = {};
let chargement = null;
export function chargeAvatars(api) {
    if (!chargement) {
        chargement = api.get('/auth/accounts')
            .then((r) => { for (const a of r.accounts || []) avatars[a.id] = a.avatar_url || null; })
            .catch(() => { chargement = null; });
    }
    return chargement;
}
export const avatarDe = (qui) => avatars[qui] || null;
export function majAvatar(qui, url) { avatars[qui] = url || null; }
export const initiale = (qui) => nom(qui).charAt(0).toUpperCase() || '?';
