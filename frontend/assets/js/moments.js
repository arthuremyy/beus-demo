/* Les deux moments plein écran qui ne sont pas des écrans :

     accueil     trois pages, une seule fois par compte et par appareil — la
                 règle du jeu dite AVANT d'y être confronté (un souvenir par
                 jour ; le sien s'ouvre quand tu as raconté le tien ; hier se
                 rattrape, avant-hier est perdu)
     publication l'instant fort de l'app : les deux anneaux se rapprochent, et
                 se croisent si l'autre avait déjà raconté sa journée */
import { getSession } from './state.js';
import { nom, autre } from './personnes.js';

const ANNEAUX_GRAND = (seul) => `<svg viewBox="0 0 140 90" aria-hidden="true">
    <circle class="m1" cx="54" cy="45" r="32" stroke="var(--encre-sam)"/>
    <circle class="m2" cx="86" cy="45" r="32" stroke="var(--encre-alex)"${seul ? '' : ' style="mix-blend-mode:screen"'}/></svg>`;

const cleAccueil = (id) => `beus:accueil:${id}`;
function dejaVu(id) { try { return localStorage.getItem(cleAccueil(id)) === '1'; } catch { return true; } }
function marqueVu(id) { try { localStorage.setItem(cleAccueil(id), '1'); } catch { /* sans stockage, tant pis */ } }

const PAGES = (moi) => [
    { titre: 'Un souvenir par jour', texte: 'Chaque jour, deux photos d’un coup : ce que tu vois, et toi. Avec l’endroit où tu es.',
      dessin: '<rect x="30" y="18" width="48" height="66" rx="4"/><rect x="38" y="26" width="16" height="22" rx="2"/><path d="M92 40h22M103 29v22"/>' },
    { titre: `Le sien s’ouvre avec le tien`, texte: `Le souvenir de ${nom(autre(moi))} reste flouté tant que tu n’as pas raconté ta journée.`,
      dessin: '<rect x="18" y="18" width="48" height="66" rx="4"/><rect x="84" y="18" width="48" height="66" rx="4" stroke-dasharray="5 5"/><rect x="99" y="44" width="18" height="14" rx="2"/><path d="M103 44v-5a5 5 0 0 1 10 0v5"/>' },
    { titre: 'Hier se rattrape, pas avant', texte: 'Une journée oubliée se raconte encore le lendemain. Après, elle est perdue, des deux côtés.',
      dessin: '<circle cx="45" cy="50" r="28"/><path d="M45 34v16l10 6"/><path d="M96 38h28M96 50h20M96 62h24"/>' },
];

/** Montre l'accueil s'il n'a jamais été vu par ce compte sur cet appareil. */
export function accueilSiPremiereFois() {
    const moi = getSession()?.user_id;
    if (!moi || dejaVu(moi) || document.querySelector('.accueil')) return Promise.resolve();
    return new Promise((fini) => {
        const pages = PAGES(moi);
        let i = 0;
        const v = document.createElement('div');
        v.className = 'accueil';
        v.setAttribute('role', 'dialog');
        v.setAttribute('aria-modal', 'true');
        v.setAttribute('aria-label', 'Bienvenue');
        const peint = () => {
            const p = pages[i];
            v.innerHTML = `
                <div class="ac-page" key="${i}">
                    <svg viewBox="0 0 150 100" stroke="var(--craie)">${p.dessin}</svg>
                    <div class="ac-titre">${p.titre}</div>
                    <p class="ac-texte">${p.texte}</p>
                </div>
                <div style="width:100%;display:flex;flex-direction:column;align-items:center">
                    <div class="ac-points" aria-hidden="true">${pages.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
                    <button class="btn btn-plein" type="button">${i < pages.length - 1 ? 'Suivant' : 'C’est parti'}</button>
                </div>`;
            v.querySelector('.btn').addEventListener('click', () => {
                if (i < pages.length - 1) { i++; peint(); return; }
                marqueVu(moi);
                v.remove();
                fini();
            });
            v.querySelector('.btn').focus({ preventScroll: true });
        };
        peint();
        document.body.appendChild(v);
    });
}

/** Après publication. `deux` : l'autre avait déjà raconté ce jour-là. */
export function momentPublication({ deux, rattrapage }) {
    const v = document.createElement('div');
    v.className = `moment${deux ? '' : ' seul'}`;
    v.setAttribute('role', 'status');
    const moi = getSession()?.user_id;
    v.innerHTML = `${ANNEAUX_GRAND(!deux)}
        <div class="m-titre">${rattrapage ? 'Journée rattrapée' : 'Journée racontée'}</div>
        <div class="m-texte">${deux ? 'Vous l’avez faite à deux.' : `En attendant ${nom(autre(moi))}.`}</div>`;
    document.body.appendChild(v);
    const part = () => { v.classList.add('part'); setTimeout(() => v.remove(), 300); };
    v.addEventListener('click', part);
    setTimeout(part, 1700);
}
