import { api } from '../api.js';
import { esc } from '../fmt.js';
import { setSession } from '../state.js';
import { classe, ordonne } from '../personnes.js';

const PIN_LEN = 6;
const CLE_DERNIER = 'beus:dernier-compte';
let accounts = null;
let selected = null;
let busy = false;
let messageExpire = null;   // posé par main.js quand une session tombe

function el() { return document.getElementById('view-login'); }
function input() { return el().querySelector('.pin-input'); }

function dernierCompte() { try { return localStorage.getItem(CLE_DERNIER); } catch { return null; } }
function retiensCompte(id) { try { localStorage.setItem(CLE_DERNIER, id); } catch { /* ignore */ } }

/** Une session qui était ouverte vient d'expirer : on le dit, et on
 *  présélectionne le compte pour ne demander que le code. */
export function sessionExpiree(compte) {
    messageExpire = 'Ta session a expiré. Reconnecte-toi.';
    if (compte) retiensCompte(compte);
}

function renderAccounts() {
    const wrap = el().querySelector('.accounts');
    // Toujours Sam | Alex : l'ordre du logo (Be · Us) et des colonnes du journal.
    wrap.innerHTML = ordonne(accounts).map((a) => `
        <button class="acct ${esc(a.id)} ${classe(a.id)} ${selected === a.id ? 'sel' : ''}" data-acct="${esc(a.id)}"
                aria-pressed="${selected === a.id}">
            <span class="ava">${a.avatar_url
                ? `<img src="${esc(a.avatar_url)}" alt="">`
                : `<span class="ph">${esc((a.display_name || a.id)[0].toUpperCase())}</span>`}</span>
            <span>${esc(a.display_name)}</span>
        </button>`).join('');
    wrap.querySelectorAll('.acct').forEach((b) =>
        b.addEventListener('click', () => selectAccount(b.dataset.acct)));
}

function selectAccount(id) {
    selected = id;
    renderAccounts();
    el().querySelector('.pin-pad').classList.add('show');
    input().value = '';
    updateDots('');
    el().querySelector('.err-msg').textContent = '';
    input().focus();
}

function updateDots(value) {
    [...el().querySelectorAll('.pin-dots i')]
        .forEach((d, i) => d.classList.toggle('on', i < value.length));
}

async function submitPin(pin) {
    if (busy || !selected) return;
    busy = true;
    try {
        const session = await api.post('/auth/login', { user_id: selected, pin });
        retiensCompte(selected);
        messageExpire = null;
        setSession(session);
        document.dispatchEvent(new CustomEvent('beus-session'));
        window.location.hash = '#/map';
    } catch (e) {
        el().querySelector('.err-msg').textContent = e.data?.detail
            || (e.status ? 'Code incorrect' : 'Connexion au serveur impossible');
        const wrap = el().querySelector('.login-wrap');
        wrap.classList.remove('shake');
        void wrap.offsetWidth;
        wrap.classList.add('shake');
        input().value = '';
        updateDots('');
        input().focus();
    } finally {
        busy = false;
    }
}

let wired = false;
function wire() {
    if (wired) return;
    wired = true;
    input().addEventListener('input', () => {
        const digits = input().value.replace(/\D/g, '').slice(0, PIN_LEN);
        input().value = digits;
        updateDots(digits);
        if (digits.length === PIN_LEN) submitPin(digits);
    });
    // Le champ est invisible (les points font l'affichage) : toucher
    // n'importe où dans le pavé doit rouvrir le clavier.
    el().querySelector('.pin-pad').addEventListener('click', () => input().focus());
}

export async function render() {
    wire();
    selected = null;
    el().querySelector('.pin-pad').classList.remove('show');
    const info = el().querySelector('#login-info');
    info.textContent = messageExpire || '';
    info.hidden = !messageExpire;
    el().querySelector('.accounts').innerHTML = '<div class="acct"><span class="ava squelette"></span></div>'.repeat(2);
    try {
        const res = await api.get('/auth/accounts');
        accounts = res.accounts;
        const dernier = dernierCompte();
        if (dernier && accounts.some((a) => a.id === dernier)) selectAccount(dernier);
        else renderAccounts();
    } catch {
        el().querySelector('.accounts').innerHTML =
            '<div class="etat erreur"><div class="etat-titre">Serveur injoignable</div>'
            + '<button class="btn btn-ghost" id="login-reessayer">Réessayer</button></div>';
        el().querySelector('#login-reessayer').addEventListener('click', render);
    }
}
