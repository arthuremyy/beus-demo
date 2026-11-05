// Souvenirs jetables pour les tests : créés au début, supprimés à la fin.
// Les tests ne doivent JAMAIS dépendre de ce qui traîne en base — c'est comme
// ça qu'un jeu d'essai d'un autre projet s'était retrouvé à peupler l'app.
import { deflateSync } from 'node:zlib';

const BASE = process.env.BASE || 'https://beus-dev.example.com';

/* Les tests tournent contre l'instance RÉELLE, avec un jeton admin : ils ont
   donc le pouvoir d'effacer de vrais souvenirs. C'est arrivé — un vrai
   souvenir a été supprimé par une passe de tests, sans sauvegarde possible.
   Depuis, chaque souvenir de test porte ce marqueur dans sa légende, et la
   suppression VÉRIFIE le marqueur avant d'agir : sans lui, elle refuse. */
const MARQUEUR = '[test-auto]';

/* Qui a créé quoi. La relecture de contrôle passe par GET /posts/{id}, qui
   applique la règle de déblocage : relire le souvenir de l'AUTRE compte peut
   renvoyer 403, la légende serait absente, et le nettoyage refuserait alors de
   supprimer — laissant des souvenirs de test en production. Un auteur voit
   toujours les siens : on relit donc avec le jeton qui a publié. */
const CREATEUR = new Map();

/** PNG uni minimal, sans dépendance : évite d'embarquer des images de test. */
export function pngUni(taille, [r, v, b]) {
    const brut = Buffer.alloc(taille * (taille * 3 + 1));
    for (let y = 0; y < taille; y++) {
        const ligne = y * (taille * 3 + 1);
        brut[ligne] = 0;
        for (let x = 0; x < taille; x++) {
            brut[ligne + 1 + x * 3] = r; brut[ligne + 2 + x * 3] = v; brut[ligne + 3 + x * 3] = b;
        }
    }
    const crcT = [...Array(256).keys()].map((n) => {
        for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
        return n >>> 0;
    });
    const crc = (buf) => {
        let c = 0xffffffff;
        for (const o of buf) c = crcT[(c ^ o) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const bloc = (tag, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const corps = Buffer.concat([Buffer.from(tag), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(corps));
        return Buffer.concat([len, corps, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
    ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
}

/** Les jours de la fenêtre de rattrapage, du plus récent au plus ancien.
 *  Sous la règle « un souvenir par jour », deux souvenirs d'un même compte ne
 *  peuvent plus partager une date : chaque fixture occupe SON jour, via le
 *  champ `day` que l'API accepte pour combler un jour passé. */
export function joursRecents(n) {
    const out = [];
    const d = new Date();
    for (let i = 0; i < n; i++) {
        const j = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
        out.push(`${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, '0')}`
            + `-${String(j.getDate()).padStart(2, '0')}`);
    }
    return out;
}

async function creer(token, { lat, lng, caption, day }, couleur) {
    const form = new FormData();
    form.append('primary_photo', new Blob([pngUni(48, couleur)], { type: 'image/png' }), 'p.png');
    form.append('secondary_photo', new Blob([pngUni(48, [30, 30, 40])], { type: 'image/png' }), 's.png');
    form.append('primary_facing', 'environment');
    form.append('lat', String(lat));
    form.append('lng', String(lng));
    form.append('caption', `${MARQUEUR} ${caption || ''}`.trim());
    if (day) form.append('day', day);
    const r = await fetch(`${BASE}/api/beus/posts`, {
        method: 'POST', body: form, headers: { Cookie: `beusauth=${token}` },
    });
    if (r.status === 409) {
        // Cas courant depuis que la fenêtre ne fait qu'un jour : les seules
        // dates publiables sont aujourd'hui et la veille, et un VRAI souvenir
        // en occupe une. On le dit clairement — un « 409 » nu envoyait chercher
        // un bug qui n'existe pas.
        throw new Error(`jour ${day || "du jour"} déjà occupé : un souvenir réel `
            + `s'y trouve. Les tests ont besoin d'aujourd'hui ET de la veille libres.`);
    }
    if (!r.ok) throw new Error(`création impossible (${r.status})`);
    const id = (await r.json()).id;
    CREATEUR.set(String(id), token);
    return id;
}

/** Deux comptes, deux pays, deux jours DIFFÉRENTS par compte.
 *
 *  Les deux points de Paris servent à éprouver le regroupement (ils doivent se
 *  fondre en un amas) ; ceux de Berlin éprouvent le cadrage sur deux pays.
 *
 *  ⚠ La fenêtre de rattrapage ne fait plus qu'UN jour : les seules dates
 *  publiables sont aujourd'hui et la veille. Les tests occupent donc forcément
 *  la journée en cours, alors qu'ils ne le faisaient pas avant. Conséquence à
 *  connaître : pendant une passe de tests, publier un vrai souvenir du jour
 *  renvoie 409. Le nettoyage de fin libère la place (l'unicité par jour est un
 *  index PARTIEL, une journée supprimée redevient publiable) — mais il ne faut
 *  pas lancer les tests pendant que quelqu'un poste. */
export async function semer({ tokenAlex, tokenSam }) {
    const [j0, j1] = joursRecents(2);
    const ids = [];
    // France (Paris, deux points proches -> ils doivent se regrouper)
    ids.push(await creer(tokenAlex, { lat: 48.8566, lng: 2.3522, caption: 'test Paris', day: j0 }, [220, 80, 60]));
    ids.push(await creer(tokenAlex, { lat: 48.8600, lng: 2.3470, caption: 'test Paris 2', day: j1 }, [210, 120, 60]));
    // Allemagne (Berlin) — mêmes jours, pour que Sam débloque ceux d'Alex
    ids.push(await creer(tokenSam, { lat: 52.5200, lng: 13.4050, caption: 'test Berlin', day: j0 }, [240, 200, 70]));
    ids.push(await creer(tokenSam, { lat: 50.9509, lng: 6.9166, caption: 'test Ehrenfeld', day: j1 }, [150, 220, 120]));
    return ids;
}

/** Variante pour éprouver le VERROU : seul Alex publie, sur les deux jours
 *  encore publiables. Sam ne les a pas remplis : elle doit les voir
 *  verrouillés, floutés, sans légende. */
export async function semerVerrous({ tokenAlex }) {
    const [j0, j1] = joursRecents(2);
    return [
        await creer(tokenAlex, { lat: 48.8566, lng: 2.3522, caption: 'test verrou 1', day: j0 }, [220, 80, 60]),
        await creer(tokenAlex, { lat: 48.8600, lng: 2.3470, caption: 'test verrou 2', day: j1 }, [210, 120, 60]),
    ];
}

/** Supprime UNIQUEMENT des souvenirs de test : chaque identifiant est relu et
 *  son marqueur vérifié avant la suppression. Un vrai souvenir est ignoré,
 *  même si un bug d'aiguillage fait passer son identifiant ici.
 *
 *  `lecteurs` : jetons supplémentaires à essayer pour la relecture. Utile pour
 *  des souvenirs créés hors de creer() — sans le jeton de leur auteur, la
 *  légende reste illisible sous la règle de déblocage, et le nettoyage refuse
 *  (il préfère laisser traîner un souvenir de test qu'en effacer un vrai). */
export async function nettoyer(tokenAdmin, ids, lecteurs = []) {
    for (const id of ids) {
        // Relecture avec le jeton de l'auteur : lui seul voit à coup sûr sa
        // propre légende, quelle que soit la règle de déblocage en vigueur.
        const candidats = [CREATEUR.get(String(id)), ...lecteurs, tokenAdmin].filter(Boolean);
        try {
            let r = null;
            for (const jeton of candidats) {
                r = await fetch(`${BASE}/api/beus/posts/${id}`, {
                    headers: { Cookie: `beusauth=${jeton}` },
                });
                if (r.ok) break;
            }
            if (!r || !r.ok) continue;                 // déjà supprimé, ou illisible
            const post = await r.json();
            if (!String(post.caption || '').startsWith(MARQUEUR)) {
                console.warn(`  ⚠ souvenir ${id} NON supprimé : ce n'est pas un souvenir de test`);
                continue;
            }
            // La suppression reste une action admin.
            await fetch(`${BASE}/api/beus/posts/${id}`, {
                method: 'DELETE', headers: { Cookie: `beusauth=${tokenAdmin}` },
            });
            CREATEUR.delete(String(id));
        } catch { /* réseau : on laisse le souvenir en place, jamais l'inverse */ }
    }
}
