// Panneau admin — l'accès est déjà gardé côté serveur (403 sur DELETE/purge si
// pas admin) ; le rendu respecte quand même la règle de déblocage pour
// l'AFFICHAGE (mêmes données que /posts/map) — seule l'action de suppression
// n'exige pas d'avoir vu le contenu, l'auteur, le jour et le lieu suffisent.
import { api } from '../api.js';
import { esc, ilYA, dateJour, heureFr } from '../fmt.js';
import { toast, toastErreur, dialogue, etatHtml } from '../composants.js';
import { IC } from '../icones.js';
import { nom } from '../personnes.js';

let purgePreview = null;
const pluriel = (n, un, plus) => `${n} ${n > 1 ? plus : un}`;

function el() { return document.getElementById('view-admin'); }

function rowHtml(p) {
    // Verrouillé côté admin aussi : la vignette floutée, jamais la photo.
    const vignette = p.unlocked
        ? `<img src="${esc(p.primary_photo_url)}" alt="">`
        : (p.blur_photo_url ? `<img src="${esc(p.blur_photo_url)}" alt="">` : '<div class="lockbox"></div>');
    const lieu = p.location_label ? ` · ${esc(p.location_label)}` : '';
    return `
        <div class="admin-post" data-id="${p.id}">
            ${vignette}
            <div class="grow"><b>${esc(nom(p.author_id))}</b> · ${esc(dateJour(p.day) || '—')}${lieu}
                <br><small>Publié à ${esc(heureFr(p.created_at))} · ${esc(ilYA(p.created_at))}</small></div>
            <button class="ico-btn" data-del="${p.id}" aria-label="Supprimer ce souvenir">${IC.corbeille}</button>
        </div>`;
}

async function loadList() {
    const list = el().querySelector('.post-list');
    list.innerHTML = '<div class="squelette" style="height:64px;margin-bottom:var(--e2)"></div>'.repeat(3);
    try {
        const { posts } = await api.get('/posts/map');
        posts.sort((a, b) => b.id - a.id);
        list.innerHTML = posts.length
            ? posts.map(rowHtml).join('')
            : etatHtml({ titre: 'Aucun souvenir publié' });
        list.querySelectorAll('[data-del]').forEach((b) =>
            b.addEventListener('click', () => onDelete(posts.find((p) => String(p.id) === b.dataset.del))));
    } catch {
        list.innerHTML = etatHtml({ titre: 'La liste n’a pas pu se charger', erreur: true,
            action: { id: 'admin-reessayer', label: 'Réessayer' } });
        list.querySelector('#admin-reessayer').addEventListener('click', loadList);
    }
}

async function onDelete(p) {
    if (!p) return;
    const oui = await dialogue({
        titre: 'Supprimer ce souvenir ?',
        texte: `Le souvenir de ${nom(p.author_id)} du ${dateJour(p.day)} : photos et mots seront effacés du disque.`,
        confirmer: 'Supprimer', danger: true,
    });
    if (!oui) return;
    try {
        await api.del(`/posts/${p.id}`);
        toast('Souvenir supprimé');
        loadList();
    } catch (e) {
        toastErreur(e, 'La suppression a échoué');
    }
}

function jours() { return Number(el().querySelector('#purge-days').value || 0); }

async function onPreviewPurge() {
    if (!jours() || jours() < 1) { toast('Indique un nombre de jours', { erreur: true }); return; }
    try {
        purgePreview = await api.post('/posts/purge', { older_than_days: jours(), dry_run: true });
        el().querySelector('#purge-result').textContent = purgePreview.count
            ? `${pluriel(purgePreview.count, 'souvenir serait supprimé', 'souvenirs seraient supprimés')} définitivement.`
            : 'Aucun souvenir aussi ancien : rien à supprimer.';
        el().querySelector('#purge-confirm').hidden = purgePreview.count === 0;
    } catch (e) {
        toastErreur(e, 'L’aperçu a échoué');
    }
}

async function onConfirmPurge() {
    const n = purgePreview?.count ?? 0;
    const oui = await dialogue({
        titre: `Supprimer ${pluriel(n, 'souvenir', 'souvenirs')} ?`,
        texte: `Tous les souvenirs de plus de ${pluriel(jours(), 'jour', 'jours')}. Sans retour possible.`,
        confirmer: 'Supprimer', danger: true,
    });
    if (!oui) return;
    try {
        const res = await api.post('/posts/purge', { older_than_days: jours(), dry_run: false });
        toast(`${pluriel(res.purged, 'souvenir supprimé', 'souvenirs supprimés')}`);
        el().querySelector('#purge-result').textContent = '';
        el().querySelector('#purge-confirm').hidden = true;
        loadList();
    } catch (e) {
        toastErreur(e, 'La purge a échoué');
    }
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    el().querySelector('#purge-preview').addEventListener('click', onPreviewPurge);
    el().querySelector('#purge-confirm').addEventListener('click', onConfirmPurge);
    el().querySelector('#purge-days').addEventListener('input', () => {
        el().querySelector('#purge-confirm').hidden = true;
        el().querySelector('#purge-result').textContent = '';
    });
}

export function render() {
    wire();
    el().querySelector('#purge-result').textContent = '';
    el().querySelector('#purge-confirm').hidden = true;
    loadList();
}
