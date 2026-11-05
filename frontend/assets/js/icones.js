/* Un seul jeu d'icônes : traits de 1,8, dessinées dans 24×24, posées en 20 px
   dans une zone de 44 px. Plus aucun glyphe texte (✕, ›, +) dans l'interface :
   ils changent de dessin d'une police à l'autre. */
const svg = (corps, extra = '') =>
    `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"${extra}>${corps}</svg>`;

export const IC = {
    croix: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    retour: svg('<path d="M15 5l-7 7 7 7"/>'),
    suite: svg('<path d="M9 5l7 7-7 7"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    bulle: svg('<path d="M4 5h16v11H9l-5 4z"/>'),
    cible: svg('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    reglages: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>'),
    crayon: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/>'),
    cadenas: svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    corbeille: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
    enregistrer: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    attention: svg('<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.2v.1"/>'),
    horsLigne: svg('<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M14 10.3A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.5-2.8M10.7 5.1A15 15 0 0 1 22 9.5"/><path d="M12 20h.01"/>'),
    retourner: svg('<path d="M20 10a8 8 0 0 0-14-4M4 14a8 8 0 0 0 14 4"/><path d="M20 5v5h-5M4 19v-5h5"/>'),
    carte: svg('<path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Z"/><path d="M9 3v15M15 6v15"/>'),
    journal: svg('<rect x="3.5" y="4" width="7.5" height="10" rx="1"/><rect x="13" y="4" width="7.5" height="10" rx="1"/><path d="M3.5 18h7.5M13 18h7.5"/>'),
    envoyer: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
    sortie: svg('<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>'),
    admin: svg('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z"/>'),
};

/** Les deux anneaux de la marque, chacun à l'encre de sa personne. */
export const ANNEAUX = '<svg class="anneaux" viewBox="0 0 36 24" aria-hidden="true">'
    + '<circle class="a1" cx="13" cy="12" r="9"/><circle class="a2" cx="23" cy="12" r="9"/></svg>';

/** Pose les icônes des éléments statiques de index.html (data-ic, boutons). */
export function peintIcones(racine = document) {
    racine.querySelectorAll('[data-ic]').forEach((n) => { n.innerHTML = IC[n.dataset.ic] || ''; });
    racine.querySelectorAll('[data-retour]').forEach((n) => { n.innerHTML = IC.retour; });
    for (const [id, ic] of [['cam-close', 'croix'], ['bloc-fermer', 'croix'], ['refus-fermer', 'croix'],
        ['review-fermer', 'croix'], ['map-fit', 'cible'], ['vers-reglages', 'reglages']]) {
        const n = racine.getElementById?.(id) || document.getElementById(id);
        if (n) n.innerHTML = IC[ic];
    }
    const flip = document.querySelector('#cam-flip .rond');
    if (flip) flip.innerHTML = IC.retourner;
}
