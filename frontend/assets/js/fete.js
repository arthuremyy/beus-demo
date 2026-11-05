/* La fête d'une médaille — une seule fois, au premier passage après l'avoir
   gagnée. Le serveur tient la liste (GET /users/me/medailles/nouvelles) et
   retient qu'elle a été fêtée (POST .../fetees), quel que soit l'appareil.

   Un coup de tampon, pas un feu d'artifice : le sceau se pose, le titre et
   ce qui l'a valu s'écrivent dessous. Rien qui brille (charte « Deux
   encres »), et rien d'animé si l'utilisateur a réduit les animations. */
import { api } from './api.js';
import { esc } from './fmt.js';
import { medailleSvg } from './medals-art.js';
import { getSession } from './state.js';

let enCours = false;

function montre(m, moi) {
    return new Promise((fini) => {
        const voile = document.createElement('div');
        voile.className = 'fete';
        voile.setAttribute('role', 'dialog');
        voile.setAttribute('aria-modal', 'true');
        voile.setAttribute('aria-label', `Médaille obtenue : ${m.titre}`);
        voile.innerHTML = `
            <div class="fete-carte">
                <div class="fete-sur">${m.famille === 'couple' ? 'Médaille à deux' : 'Médaille'}</div>
                <div class="fete-sceau">${medailleSvg(m, moi)}</div>
                <div class="fete-titre">${esc(m.titre)}</div>
                <p class="fete-desc">${esc(m.description)}</p>
                <button class="btn btn-plein" type="button">Continuer</button>
                <button class="lien" type="button" data-voir>Voir mes médailles</button>
            </div>`;
        document.body.appendChild(voile);
        const ferme = () => { voile.remove(); fini(); };
        voile.querySelector('.btn').addEventListener('click', ferme);
        voile.querySelector('[data-voir]').addEventListener('click', () => {
            ferme();
            window.location.hash = '#/profile';
        });
        voile.querySelector('button').focus();
    });
}

/** Fête ce qui attend, une médaille après l'autre. Sans effet si rien n'attend. */
export async function fete() {
    const moi = getSession()?.user_id;
    if (!moi || enCours) return;
    enCours = true;
    try {
        const { medailles } = await api.get('/users/me/medailles/nouvelles');
        if (!medailles?.length) return;
        // Marquées AVANT l'affichage : un rechargement en pleine fête ne doit
        // pas la rejouer.
        await api.post('/users/me/medailles/fetees', { codes: medailles.map((m) => m.code) });
        for (const m of medailles) await montre(m, moi);
    } catch { /* hors ligne : ce sera pour la prochaine fois */ } finally {
        enCours = false;
    }
}
