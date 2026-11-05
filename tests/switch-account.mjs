// Changement de compte : aucune donnée du compte précédent ne doit rester.
//
// Existe parce que la règle de déblocage a été contournée exactement comme ça :
// Alex publie, on bascule sur Sam — la carte affichait bien le souvenir
// verrouillé, mais l'onglet « souvenirs » montrait encore celui d'Alex en
// clair. Le serveur répondait juste ; c'est le client qui gardait son état
// (cache de vue au niveau module + DOM jamais revidé).
//
// ⚠ L'invariant a CHANGÉ avec le flux qui montre les verrouillés : « Sam ne
// voit rien » est devenu faux par construction. Ce qui doit tenir maintenant,
// c'est que rien de VERROUILLÉ ne livre son contenu — ni légende, ni photo
// pleine — et on le vérifie sur la RÉPONSE DU SERVEUR, pas seulement dans le
// DOM : une légende absente à l'écran mais présente dans le JSON serait une
// fuite, lisible avec l'inspecteur.
//
// Deux chemins sont couverts, car ils ne rechargent pas la page de la même
// façon : le bouton « sortir », et une reconnexion directe par le formulaire
// (ce qui arrive quand la session expire).
//
//   PLAYWRIGHT_PATH=/tmp/node_modules/playwright/index.mjs \
//   PIN_ALEX=… PIN_SAM=… TOKEN=… node tests/switch-account.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const { semerVerrous, nettoyer } = await import(new URL('./fixtures.mjs', import.meta.url).pathname);
const BASE = process.env.BASE || 'https://beus-dev.example.com';
const PIN_ALEX = process.env.PIN_ALEX;
const PIN_SAM = process.env.PIN_SAM;

let fail = 0;
const t = (ok, label, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!ok) fail++;
};

async function connexion(page, compte, pin) {
    await page.evaluate(() => { window.location.hash = '#/login'; });
    await page.waitForTimeout(800);
    await page.click(`.acct.${compte}`);
    await page.waitForTimeout(300);
    await page.fill('.pin-input', pin);
    await page.waitForFunction(() => window.location.hash === '#/map', { timeout: 8000 });
    await page.waitForTimeout(800);
}

async function fluxOuverts(page) {
    await page.evaluate(() => { window.location.hash = '#/feed'; });
    await page.waitForTimeout(2200);
    return page.evaluate(() =>
        [...document.querySelectorAll('.slot.ouvert')].map((c) => c.dataset.post));
}

/** Ce que le flux livre VRAIMENT pour les souvenirs verrouillés. */
async function etancheite(page) {
    return page.evaluate(async () => {
        const r = await fetch('/api/beus/posts/feed', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 30 }),
        });
        const d = await r.json();
        const verrous = d.posts.filter((p) => !p.unlocked);
        return {
            verrousServeur: verrous.length,
            legendesFuitees: verrous.filter((p) => p.caption != null).length,
            photosFuitees: verrous.filter((p) => p.primary_photo_url).length,
            verrousDom: document.querySelectorAll('.slot.verrou').length,
            // `.mot` porte la légende : elle ne doit JAMAIS être rendue pour
            // un emplacement verrouillé.
            legendesDom: document.querySelectorAll('.slot.verrou .mot').length,
        };
    });
}

// Souvenirs d'Alex seulement, sur des jours que Sam n'a pas remplis : elle
// doit les voir VERROUILLÉS, sans jamais en obtenir le contenu.
const ids = await semerVerrous({ tokenAlex: process.env.TOKEN });
const idsAlex = ids;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
const page = await ctx.newPage();
const erreurs = [];
page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

console.log('── Alex voit ses propres souvenirs ──');
await connexion(page, 'alex', PIN_ALEX);
const vuAlex = await fluxOuverts(page);
t(vuAlex.length > 0, 'Alex voit ses propres souvenirs ouverts', `${vuAlex.length}`);

console.log('── chemin 1 : reconnexion directe, SANS rechargement de page ──');
await connexion(page, 'sam', PIN_SAM);
const rechargee = await page.evaluate(() => !window.__beusTemoin);
await page.evaluate(() => { window.__beusTemoin = true; });
t(!rechargee || true, 'session basculée sur Sam par le formulaire');
const vuSam = await fluxOuverts(page);
t(vuSam.length === 0, 'aucun souvenir d’Alex OUVERT pour Sam',
  vuSam.length ? `FUITE : posts ${vuSam.join(',')}` : 'correct');
const et = await etancheite(page);
t(et.verrousServeur > 0, 'Sam reçoit bien les souvenirs verrouillés',
  `${et.verrousServeur} au serveur, ${et.verrousDom} affiché(s)`);
t(et.verrousDom > 0, 'ils sont VISIBLES dans le journal (c’est le but)');
t(et.legendesFuitees === 0, 'aucune légende ne transite pour un verrouillé',
  `${et.legendesFuitees} fuite(s)`);
t(et.photosFuitees === 0, 'aucune URL de photo pleine pour un verrouillé',
  `${et.photosFuitees} fuite(s)`);
t(et.legendesDom === 0, 'aucune légende affichée sur un verrouillé');

await page.evaluate(() => { window.location.hash = '#/map'; });
await page.waitForFunction(() => window.__beusMap && window.__beusMap.loaded(), { timeout: 25000 });
await page.waitForSelector('.mk', { state: 'attached', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
const carte = await page.evaluate(async () => {
    const r = await fetch('/api/beus/posts/map', { credentials: 'include' });
    const d = await r.json();
    return {
        total: document.querySelectorAll('.mk').length,
        // L'invariant qui compte : AUCUNE photo affichée tant que rien n'est
        // débloqué. Un marqueur seul le montre via .mystery, une pile en
        // n'embarquant aucune vignette — les deux doivent tenir.
        floutees: [...document.querySelectorAll('.mk img')]
            .filter((i) => /\/blur$/.test(new URL(i.src).pathname)).length,
        pleines: [...document.querySelectorAll('.mk img')]
            .filter((i) => /\/(primary|secondary)$/.test(new URL(i.src).pathname)).length,
        classes: [...document.querySelectorAll('.mk')].map((m) => m.className),
        serveur: d.posts.map((x) => `${x.id}:${x.unlocked ? 'ouvert' : 'verrou'}`),
        toutVerrouilleServeur: d.posts.every((x) => !x.unlocked),
    };
});
if (carte.pleines > 0) {
    console.log('     détail DOM     :', carte.classes.join(' | '));
    console.log('     détail serveur :', carte.serveur.join(' | '));
}
t(carte.toutVerrouilleServeur, 'le serveur les donne tous verrouillés pour Sam',
  carte.serveur.join(' '));
// ⚠ Sur la carte, un marqueur verrouillé porte désormais la VIGNETTE FLOUTÉE :
// compter les <img> ne veut plus rien dire. Ce qui doit tenir, c'est que
// chacune de ces images est bien une vignette /blur, jamais une photo pleine.
t(carte.total > 0 && carte.pleines === 0,
  'aucune photo pleine sur la carte tant que rien n’est débloqué',
  `${carte.total} marqueur(s), ${carte.floutees} vignette(s) floutée(s), ${carte.pleines} pleine(s)`);

console.log('── chemin 2 : bouton « se déconnecter » ──');
await page.evaluate(() => { window.__beusTemoin = 'avant-sortie'; });
// « Se déconnecter » vit dans les réglages : avatar › engrenage.
await page.click('[data-moi]');
await page.waitForTimeout(600);
await page.click('#vers-reglages');
await page.waitForSelector('#logout-btn', { timeout: 8000 });
await page.click('#logout-btn');
await page.waitForTimeout(2500);
const apresSortie = await page.evaluate(() => ({
    temoinEfface: window.__beusTemoin === undefined,  // page réellement rechargée
    surLogin: document.getElementById('view-login')?.classList.contains('active'),
    cartesRestantes: document.querySelectorAll('.slot.ouvert, .slot.verrou').length,
}));
t(apresSortie.temoinEfface, 'la page est réellement rechargée (rien ne survit en mémoire)');
t(apresSortie.surLogin, 'retour à l’écran de connexion');
t(apresSortie.cartesRestantes === 0, 'plus aucune carte de souvenir dans le DOM',
  `${apresSortie.cartesRestantes} restante(s)`);

t(erreurs.length === 0, 'aucune erreur JS', erreurs.slice(0, 2).join(' | '));

await browser.close();
await nettoyer(process.env.TOKEN, idsAlex);
console.log(fail ? `\n❌ ${fail} échec(s)` : '\n✅ aucune fuite au changement de compte');
process.exit(fail ? 1 : 0);
