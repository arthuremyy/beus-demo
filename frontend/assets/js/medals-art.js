/* ============================================================================
   Dessin des médailles — une famille visuelle, deux familles de sens.

   Un seul gabarit : un sceau circulaire à filet fin, et un glyphe au centre.
   Ce qui distingue les deux familles n'est PAS une étiquette, c'est la
   structure du sceau :

     · Seul   — un anneau, à l'encre de son propriétaire (rose pour Sam,
                or pour Alex — voir personnes.js et --encre-*).
     · À deux — DEUX anneaux décalés, un de chaque encre. Là où ils se
                croisent, la surimpression apparaît (mix-blend-mode:screen,
                comme deux passages de presse mal calés). Une médaille de
                couple se reconnaît de loin, sans savoir lire.

   Obtenue : le glyphe est tracé à l'encre. À gagner : filet seul, en gris de
   trait, un arc fin autour du sceau qui dit l'avancement d'un coup d'œil, et
   le compte exact sous le sceau (« 7 / 10 »).

   Pas d'emoji, pas de dégradé, pas d'ombre. Tout est en traits.
   ========================================================================== */

import { encre as encreDe } from './personnes.js';

const SAM = encreDe('sam');
const ALEX = encreDe('alex');
const ETEINT = 'var(--trait)';
const R_ARC = 46;

/** Les paliers de volume portent leur nombre : c'est le glyphe le plus lisible
 *  qui soit pour « dix jours », et ça évite d'inventer dix symboles abstraits
 *  que personne ne saurait relire. */
const NOMBRES = { premier: '1', dix: '10', cinquante: '50', cent: '100', annee: '365' };

/** Glyphes géométriques — deux traits maximum, dans un carré 100×100 centré. */
const GLYPHES = {
    // cinq immeubles : une ligne d'horizon
    villes_5: '<path d="M30 60v-8h7v8M41 60V44h7v16M52 60V38h7v22M63 60V48h7v12M74 60v-6h-3"/>'
        + '<path d="M26 62h48"/>',
    // deux arcs : un méridien traversé
    pays_2: '<circle cx="50" cy="50" r="17"/><path d="M50 33c7 5 7 29 0 34M50 33c-7 5-7 29 0 34"/>',
    // le soleil qui dépasse la ligne
    leve_tot: '<path d="M36 56a14 14 0 0 1 28 0"/><path d="M28 56h44M50 30v6M34 38l4 4M66 38l-4 4"/>',
    // le croissant
    couche_tard: '<path d="M58 34a17 17 0 1 0 0 32 20 20 0 0 1 0-32Z"/>',
    // deux points, une même ligne dessous
    cote_a_cote: '<circle cx="43" cy="46" r="4.5"/><circle cx="57" cy="46" r="4.5"/>'
        + '<path d="M34 60h32"/>',
    // les deux points, dix fois
    cote_a_cote_10: '<circle cx="43" cy="42" r="4" /><circle cx="57" cy="42" r="4"/>'
        + '<path d="M34 54h32"/><path d="M38 66h3M45 62v8M51 62h6v8h-6z"/>',
    // deux points dans une même enceinte
    meme_ville: '<rect x="30" y="36" width="40" height="28"/>'
        + '<circle cx="42" cy="50" r="4"/><circle cx="58" cy="50" r="4"/>',
    // deux aiguilles au même angle
    synchro: '<circle cx="50" cy="50" r="18"/><path d="M50 50V36M50 50l10 6"/>',
    // sept barres
    semaine: '<path d="M32 38v24M38 38v24M44 38v24M50 38v24M56 38v24M62 38v24M68 38v24"/>',
    // un mois : quatre rangs de sept
    mois: '<path d="M30 38h40M30 46h40M30 54h40M30 62h40"/>'
        + '<path d="M36 34v32M48 34v32M60 34v32"/>',
};

function sceau(famille, encre, contenu) {
    if (famille === 'couple') {
        // Deux anneaux décalés. Le second en surimpression : c'est LE signe de
        // la famille « à deux », et la seule place où deux encres se croisent.
        return `<circle cx="42" cy="50" r="34" fill="none" stroke="${encre.a}" stroke-width="2"/>`
            + `<circle cx="58" cy="50" r="34" fill="none" stroke="${encre.b}" stroke-width="2"`
            + ' style="mix-blend-mode:screen"/>'
            + contenu;
    }
    return `<circle cx="50" cy="50" r="38" fill="none" stroke="${encre.a}" stroke-width="2"/>`
        + `<circle cx="50" cy="50" r="33" fill="none" stroke="${encre.a}" stroke-width=".6"`
        + ' opacity=".6"/>' + contenu;
}

/**
 * @param {object} m         une entrée de medailles.solo / medailles.couple
 * @param {string} auteurId  'alex' | 'sam' — décide de l'encre des médailles solo
 */
export function medailleSvg(m, auteurId) {
    const sienne = encreDe(auteurId);
    const encre = m.obtenue
        ? (m.famille === 'couple' ? { a: SAM, b: ALEX } : { a: sienne, b: sienne })
        : { a: ETEINT, b: ETEINT };
    const trait = m.obtenue ? (m.famille === 'couple' ? 'var(--surimpr)' : sienne) : ETEINT;

    let glyphe;
    if (NOMBRES[m.code]) {
        // Le nombre, à la même encre que le sceau. Fraunces est déjà chargée.
        const taille = NOMBRES[m.code].length > 2 ? 26 : 34;
        glyphe = `<text x="50" y="50" text-anchor="middle" dominant-baseline="central"`
            + ` font-family="var(--disp)" font-size="${taille}" fill="${trait}"`
            + ` letter-spacing="-1">${NOMBRES[m.code]}</text>`;
    } else {
        glyphe = `<g fill="none" stroke="${trait}" stroke-width="2.2" stroke-linecap="round"`
            + ` stroke-linejoin="round">${GLYPHES[m.code] || ''}</g>`;
    }

    // L'avancement : un arc depuis midi, dans le sens des aiguilles.
    let arc = '';
    // Sous 5 %, l'arc n'est qu'un point qui ressemble à une poussière.
    if (!m.obtenue && m.cible > 0 && m.avancement / m.cible >= 0.05) {
        const tour = 2 * Math.PI * R_ARC;
        const part = Math.min(1, m.avancement / m.cible) * tour;
        arc = `<circle cx="50" cy="50" r="${R_ARC}" fill="none" stroke="var(--craie-faible)" stroke-width="2"`
            + ` stroke-linecap="round" stroke-dasharray="${part.toFixed(1)} ${tour.toFixed(1)}"`
            + ' transform="rotate(-90 50 50)"/>';
    }

    return `<svg viewBox="0 0 100 100" aria-hidden="true">${sceau(m.famille, encre, glyphe)}${arc}</svg>`;
}
