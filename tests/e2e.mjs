// Test de bout en bout du frontend — charge la page RÉELLEMENT servie, exécute
// son JS dans un DOM, pilote l'interface contre l'API réelle. BeUs est public
// (pas Tailscale) : pas d'override d'IP, on tape le domaine directement.
//
// Volontairement, ce test ne navigue PAS vers #/map ni #/capture (MapLibre et
// getUserMedia ont besoin d'un vrai moteur de rendu — voir tests/shoot.mjs) :
// il couvre le routeur, l'écran de connexion et le flux, en DOM pur.
//
//   cd /tmp && npm install jsdom
//   TOKEN=$(docker exec beus-dev python3 -c "import security; \
//     print(security.create_token('alex', True))")
//   JSDOM_PATH=/tmp/node_modules/jsdom TOKEN="$TOKEN" node tests/e2e.mjs

const pkg = (await import(process.env.JSDOM_PATH || 'jsdom')).default;
const { JSDOM } = pkg;
import https from 'node:https';
import http from 'node:http';

// BASE : une instance jetable (http://localhost:…) plutôt que la production.
const BASE = new URL(process.env.BASE || 'https://beus-dev.example.com');
const TOKEN = process.env.TOKEN;

function req(path, { method = 'GET', cookie = false } = {}) {
    return new Promise((res, rej) => {
        const r = (BASE.protocol === 'http:' ? http : https).request({
            host: BASE.hostname, port: BASE.port || (BASE.protocol === 'http:' ? 80 : 443), path, method,
            headers: cookie ? { Cookie: `beusauth=${TOKEN}` } : {},
        }, (r2) => { let b = ''; r2.on('data', (c) => b += c); r2.on('end', () => res({ status: r2.statusCode, body: b })); });
        r.on('error', rej); r.end();
    });
}

const page = await req('/');
if (page.status !== 200) { console.log('❌ page HTTP', page.status); process.exit(1); }

const dom = new JSDOM(page.body, { url: `${BASE.origin}/`, pretendToBeVisual: true });
const w = dom.window;
const errors = [];

globalThis.window = w;
globalThis.document = w.document;
globalThis.history = w.history;
globalThis.CustomEvent = w.CustomEvent;

// Phase 1 délibérément SANS cookie : simule un navigateur non connecté.
globalThis.fetch = w.fetch = async (input, init = {}) => {
    const url = new URL(String(input), `${BASE.origin}/`);
    const r = await req(url.pathname + url.search, { method: init.method || 'GET', cookie: false });
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
};
process.on('unhandledRejection', (e) => errors.push('rejet: ' + (e?.stack || e)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond, max = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < max) { if (cond()) return true; await wait(80); }
    return false;
}

const JS = '/srv/beus/frontend/assets/js';
try { await import(JS + '/main.js'); }
catch (e) { console.log('❌ main.js a échoué au chargement :\n  ' + (e.stack || e)); process.exit(1); }

const d = w.document, q = (s) => d.querySelector(s);
const check = (ok, label, extra = '') => { console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`); return ok; };
let fails = 0;
const t = (...a) => { if (!check(...a)) fails++; };

console.log('── Chargement (sans cookie -> écran de connexion) ──');
await jusqua(() => d.getElementById('view-login')?.classList.contains('active'));
t(errors.length === 0, 'aucune erreur JS', errors.slice(0, 2).join(' | '));
t(d.getElementById('view-login')?.classList.contains('active'), 'vue de connexion active');
// Régression : le routeur doit poser `hidden` (attribut/propriété IDL, pas
// juste une classe) sur #nav en dehors d'une session — c'est CETTE valeur que
// le CSS `#nav[hidden]{display:none}` doit ensuite respecter (jsdom n'a pas de
// moteur CSS fiable pour vérifier le rendu — voir tests/shoot.mjs pour ça).
t(d.getElementById('nav')?.hidden === true, 'nav basse marquée hidden sur l’écran de connexion');
await jusqua(() => d.querySelectorAll('.accounts .acct').length === 2);
t(d.querySelectorAll('.accounts .acct').length === 2, 'deux comptes proposés (Alex/Sam)');

console.log('── Connexion via cookie déjà posé (simulateur) ──');
document.cookie = `beusauth=${TOKEN}`;
w.location.hash = '#/feed';
w.dispatchEvent(new w.Event('hashchange'));
// Le hash seul ne relance pas le bootstrap de session (fait au chargement de
// page) : on ré-importe main.js dans un DOM frais avec le cookie déjà présent.
const page2 = await req('/', { cookie: true });
const dom2 = new JSDOM(page2.body, { url: `${BASE.origin}/#/feed`, pretendToBeVisual: true });
globalThis.window = dom2.window;
globalThis.document = dom2.window.document;
globalThis.history = dom2.window.history;
globalThis.CustomEvent = dom2.window.CustomEvent;
globalThis.fetch = dom2.window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), `${BASE.origin}/`);
    const r = await req(url.pathname + url.search, { method: init.method || 'GET', cookie: true });
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
};
await import(JS + '/main.js?session=' + Date.now());
await wait(1500);
const d2 = dom2.window.document;
t(d2.getElementById('view-feed')?.classList.contains('active'), 'vue flux active après connexion');
t(!d2.getElementById('nav').hidden, 'nav basse visible une fois connecté');
t(d2.body.classList.contains('is-admin'), 'compte alex reconnu admin');

console.log('── Admin ──');
// L'admin n'est plus un onglet : on y arrive depuis le profil (lien « Admin »).
dom2.window.location.hash = '#/admin';
dom2.window.dispatchEvent(new dom2.window.Event('hashchange'));
await wait(600);
t(d2.getElementById('view-admin')?.classList.contains('active'), 'panneau admin accessible à l’admin');

console.log(fails ? `\n❌ ${fails} échec(s)` : '\n✅ tous les tests e2e passent');
process.exit(fails ? 1 : 0);
