// Vérifie les trois reproches concrets faits sur la première version :
//   1. la carte ne réagissait pas (une vue plein écran avalait les gestes) ;
//   2. elle restait bloquée sur la France au lieu de cadrer les souvenirs ;
//   3. en zoomant, le marqueur recouvrait le lieu qu'il désigne.
// Chaque point est mesuré sur la page réelle, pas relu dans le CSS.
//
//   PLAYWRIGHT_PATH=/tmp/node_modules/playwright/index.mjs \
//   TOKEN="$(docker exec beus-dev python3 -c "import security;print(security.create_token('alex',True))")" \
//   node tests/map-ux.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const { semer, nettoyer } = await import(new URL('./fixtures.mjs', import.meta.url).pathname);
const BASE = process.env.BASE || 'https://beus-dev.example.com';

// Jeu d'essai créé ici même (France + Allemagne), supprimé à la fin : le test
// ne dépend d'aucun historique et ne laisse rien derrière lui.
const ids = await semer({ tokenAlex: process.env.TOKEN, tokenSam: process.env.TOKEN_SAM });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
await ctx.addCookies([{ name: 'beusauth', value: process.env.TOKEN,
    domain: new URL(BASE).hostname, path: '/', secure: true }]);
const page = await ctx.newPage();
const erreurs = [];
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message));

let fail = 0;
const t = (ok, label, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!ok) fail++;
};
const vue = () => page.evaluate(() => {
    const m = window.__beusMap;
    return { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom() };
});

await page.goto(`${BASE}/#/map`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__beusMap && window.__beusMap.loaded(), { timeout: 20000 });
await page.waitForTimeout(2500);
await page.evaluate(async () => {
    const r = await fetch('/api/beus/posts/map', { credentials: 'include' });
    const { posts } = await r.json();
    const p = posts.find((x) => x.lat != null);
    window.__beusPremierPoint = [p.lng, p.lat];
});

console.log('── 1. la carte reçoit bien les gestes ──');
const avant = await vue();
// Glissement au centre de l'écran : là où la vue carte se superposait.
await page.mouse.move(195, 430);
await page.mouse.down();
await page.mouse.move(120, 330, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(700);
const apres = await vue();
t(Math.abs(apres.lng - avant.lng) > 1e-4 || Math.abs(apres.lat - avant.lat) > 1e-4,
  'un glissement déplace la carte',
  `${avant.lng.toFixed(3)},${avant.lat.toFixed(3)} -> ${apres.lng.toFixed(3)},${apres.lat.toFixed(3)}`);

await page.mouse.move(195, 430);
await page.mouse.wheel(0, -400);
await page.waitForTimeout(700);
const zoome = await vue();
t(zoome.zoom > apres.zoom, 'la molette zoome', `${apres.zoom.toFixed(2)} -> ${zoome.zoom.toFixed(2)}`);
// Pas de boutons de zoom : le pincement suffit, la carte reste nue.
t(await page.locator('.maplibregl-ctrl-zoom-in').count() === 0, 'pas de boutons de zoom');

console.log('── 2. cadrage sur les souvenirs, pas sur un pays par défaut ──');
// « Recentrer » n'apparaît qu'après un geste ; en headless le glissé peut
// échouer (limite connue) : on le déclenche directement.
await page.evaluate(() => document.getElementById('map-fit').click());
await page.waitForTimeout(1400);
const fit = await vue();
const marqueurs = await page.locator('.mk').count();
t(marqueurs > 0, 'marqueurs présents', `${marqueurs} marqueur(s)`);
// Les souvenirs couvrent Paris et Berlin : le cadrage doit tenir les deux,
// donc se centrer entre les deux villes, pas rester sur une seule.
t(fit.zoom > 4 && fit.zoom < 9, '« tout voir » cadre les deux pays',
  `zoom ${fit.zoom.toFixed(2)}`);
t(fit.lng > 4 && fit.lng < 8 && fit.lat > 45 && fit.lat < 52,
  'le centre tombe entre Paris et Berlin',
  `${fit.lng.toFixed(2)}, ${fit.lat.toFixed(2)}`);

console.log('── 3. le marqueur ne masque plus l’endroit ──');
// Les marqueurs sont redessinés à chaque changement de zoom (regroupement) :
// on attend qu'ils soient de nouveau posés avant de mesurer.
async function tailleBulleA(zoom) {
    // On se recentre sur un souvenir : les marqueurs ne sont posés que pour ce
    // qui est à l'écran (supercluster interroge la fenêtre courante).
    await page.evaluate((z) => {
        const m = window.__beusMap;
        m.jumpTo({ center: window.__beusPremierPoint, zoom: z });
    }, zoom);
    await page.waitForTimeout(700);
    await page.waitForSelector('.mk .mk-bubble', { state: 'attached', timeout: 8000 });
    return page.evaluate(() => {
        const b = document.querySelector('.mk .mk-bubble').getBoundingClientRect();
        return b.height;
    });
}
const hMonde = await tailleBulleA(2);
const hVille = await tailleBulleA(11);
const hRue = await tailleBulleA(17);
t(hRue < hVille * 0.75, 'plus petit en vue rue qu’en vue ville',
  `${hVille.toFixed(1)}px -> ${hRue.toFixed(1)}px`);
t(hMonde < hVille * 0.75, 'plus petit en vue monde qu’en vue ville',
  `${hMonde.toFixed(1)}px vs ${hVille.toFixed(1)}px`);

console.log('── 4. les souvenirs proches sont regroupés ──');
const groupes = await page.evaluate(async () => {
    window.__beusMap.jumpTo({ center: [5.9, 48.3], zoom: 5 });
    await new Promise((r) => setTimeout(r, 900));
    return { total: document.querySelectorAll('.mk').length,
             piles: document.querySelectorAll('.mk.cluster').length,
             compte: [...document.querySelectorAll('.mk.cluster .count')].map((n) => +n.textContent) };
});
t(groupes.piles > 0, 'des piles apparaissent en vue large',
  `${groupes.piles} pile(s) sur ${groupes.total} marqueur(s)`);
t(groupes.compte.every((n) => n >= 2), 'chaque pile annonce au moins 2 souvenirs',
  groupes.compte.join('+'));

// La pointe doit tomber sur la coordonnée exacte du souvenir : c'est ce qui
// permet de voir OÙ la photo a été prise, même marqueur affiché par-dessus.
// Au-delà du `maxZoom` de supercluster (16), plus aucun regroupement : on est
// sûr d'avoir un marqueur individuel à mesurer.
await page.evaluate((c) => window.__beusMap.jumpTo({ center: c, zoom: 17.5 }),
                     await page.evaluate(() => window.__beusPremierPoint));
await page.waitForTimeout(900);
await page.waitForSelector('.mk:not(.cluster)', { state: 'attached', timeout: 8000 });
const ecart = await page.evaluate(() => {
    const m = window.__beusMap;
    // Marqueur individuel (pas une pile) réellement posé après le redessin.
    const marker = window.__beusMarkers.find((mk) => !mk.getElement().classList.contains('cluster'));
    const canvas = m.getCanvas().getBoundingClientRect();
    const cible = m.project(marker.getLngLat());           // pixels dans le canvas
    const r = marker.getElement().getBoundingClientRect(); // pixels écran
    return { dx: Math.abs((r.left + r.width / 2) - (canvas.left + cible.x)),
             dy: Math.abs(r.bottom - (canvas.top + cible.y)) };
});
t(ecart.dx < 8 && ecart.dy < 8, 'la pointe est sur la coordonnée exacte',
  `écart ${ecart.dx.toFixed(1)}px / ${ecart.dy.toFixed(1)}px`);

console.log('── erreurs JS ──');
t(erreurs.length === 0, 'aucune erreur console', erreurs.slice(0, 2).join(' | '));

await browser.close();
await nettoyer(process.env.TOKEN, ids);
console.log(fail ? `\n❌ ${fail} échec(s)` : '\n✅ carte interactive, cadrée et lisible');
process.exit(fail ? 1 : 0);
