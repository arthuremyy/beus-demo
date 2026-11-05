/* Réglages — écran poussé depuis « Nous » (engrenage en haut à droite).
   Tout ce qui se règle, et la déconnexion en évidence : sur un téléphone
   partagé à deux, changer de compte est un geste courant. */
import { api } from '../api.js';
import { esc } from '../fmt.js';
import { getSession, setSession } from '../state.js';
import { peintMoi } from '../ui.js';
import { toast, toastErreur } from '../composants.js';
import { IC } from '../icones.js';
import * as push from '../push.js';
import * as profile from './profile.js';

function el() { return document.getElementById('view-settings'); }

/* Les notifications : l'état de CET appareil, et le seul geste qui compte. */
const TEXTE_NOTIF = {
    installer: 'Sur iPhone, les notifications ne marchent que depuis l’icône : dans Safari, '
        + 'Partager › Sur l’écran d’accueil, puis ouvre BeUs depuis cette icône.',
    indisponible: 'Ce navigateur ne sait pas recevoir de notifications.',
    serveur: 'Les notifications ne sont pas encore configurées sur le serveur.',
    refuse: 'Notifications refusées pour BeUs. Réglages › Notifications › BeUs pour les rouvrir.',
    actif: 'Activées sur cet appareil : nouveaux souvenirs, nouveaux mots, et un rappel à 15 h et 21 h.',
    inactif: 'Être prévenu quand l’autre raconte sa journée ou t’écrit un mot.',
};

async function peintNotifs() {
    const bloc = el().querySelector('#notifs');
    if (!bloc) return;
    const e = await push.etat();
    if (!el().querySelector('#notifs')) return;
    const bouton = e === 'inactif'
        ? '<button class="btn btn-ghost" id="notif-on">Activer les notifications</button>'
        : e === 'actif' ? '<button class="btn btn-ghost" id="notif-off">Désactiver</button>' : '';
    bloc.innerHTML = `<p class="notif-texte">${esc(TEXTE_NOTIF[e] || '')}</p>${bouton}`;
    bloc.querySelector('#notif-on')?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try { await push.activer(); toast('Notifications activées'); }
        catch (err) { toast(err.message || 'L’activation a échoué', { erreur: true }); }
        peintNotifs();
    });
    bloc.querySelector('#notif-off')?.addEventListener('click', async () => {
        await push.desactiver();
        toast('Notifications désactivées');
        peintNotifs();
    });
}

function paint(p) {
    el().querySelector('.scroll').innerHTML = `
        <div class="reglage">
            <div class="reglage-titre">Se présenter</div>
            <div class="champ">
                <label for="pf-nom">Nom</label>
                <input id="pf-nom" maxlength="24" value="${esc(p.display_name)}" autocomplete="off">
            </div>
            <div class="champ">
                <label for="pf-bio">Deux mots</label>
                <textarea id="pf-bio" maxlength="180" rows="2">${esc(p.bio || '')}</textarea>
            </div>
            <button class="btn btn-plein" id="pf-save" disabled>Enregistrer</button>
        </div>
        <div class="reglage">
            <div class="reglage-titre">Notifications</div>
            <div id="notifs"><p class="notif-texte">…</p></div>
        </div>
        <div class="reglage liens">
            ${getSession()?.is_admin ? `<button class="ligne" id="vers-admin">Admin<span class="ic">${IC.suite}</span></button>` : ''}
            <button class="ligne danger" id="logout-btn">Se déconnecter<span class="ic">${IC.sortie}</span></button>
        </div>`;
    const nomI = el().querySelector('#pf-nom');
    const bioI = el().querySelector('#pf-bio');
    const save = el().querySelector('#pf-save');
    // « Enregistrer » ne s'allume que s'il y a quelque chose à enregistrer.
    const change = () => {
        save.disabled = !nomI.value.trim()
            || (nomI.value === p.display_name && bioI.value === (p.bio || ''));
    };
    nomI.addEventListener('input', change);
    bioI.addEventListener('input', change);
    save.addEventListener('click', async () => {
        save.disabled = true;
        try {
            const maj = await api.patch('/users/me', { display_name: nomI.value, bio: bioI.value });
            Object.assign(p, maj);
            const s = getSession();
            if (s) { setSession({ ...s, display_name: maj.display_name }); peintMoi(); }
            profile.reset();
            toast('Profil enregistré');
        } catch (err) {
            toastErreur(err, 'L’enregistrement a échoué');
            change();
        }
    });
    el().querySelector('#vers-admin')?.addEventListener('click', () => { window.location.hash = '#/admin'; });
    peintNotifs();
}

export async function render() {
    const s = getSession();
    // Rendu immédiat avec la session, puis complété par le profil (la bio).
    paint({ display_name: s?.display_name || '', bio: '' });
    try { paint(await api.get('/users/me')); } catch { /* la session suffit pour l'essentiel */ }
}
