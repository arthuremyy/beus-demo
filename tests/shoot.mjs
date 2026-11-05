// Captures réelles des vues principales — iPhone en priorité (app iOS
// uniquement), une largeur desktop en complément. BeUs est fixe-sombre (pas de
// bascule de thème, contrairement au dashboard/job-radar).
//
//   cd /tmp && npm install playwright && npx playwright install chromium
//   PLAYWRIGHT_PATH=/tmp/node_modules/playwright/index.mjs \
//   TOKEN="$(docker exec beus-dev python3 -c "import security;print(security.create_token('alex',True))")" \
//   node tests/shoot.mjs
//
// playwright reste hors dépôt : il ne sert qu'à la vérification.
// Caméra simulée (device factice) pour que /#/capture rende quelque chose en headless.

const BASE = process.env.BASE || 'https://beus-dev.example.com';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const TOKEN = process.env.TOKEN;
const OUT = process.env.OUT || '/tmp/beus-shots';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
    args: ['--ignore-certificate-errors', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function shoot(width, height, label) {
    const ctx = await browser.newContext({
        viewport: { width, height }, ignoreHTTPSErrors: true, deviceScaleFactor: 2,
        permissions: ['geolocation'], geolocation: { latitude: 48.8566, longitude: 2.3522 },
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
    await ctx.addCookies([{ name: 'beusauth', value: TOKEN, domain: new URL(BASE).hostname, path: '/', secure: true }]);
    const page = await ctx.newPage();
    const errs = [];
    // La capture « login » se fait SANS cookie : /auth/me répond 401, c'est le
    // fonctionnement normal (c'est ainsi que l'app sait qu'on n'est pas
    // connecté). Le compter comme une erreur faisait échouer le test à chaque
    // passage, pour un cas attendu.
    let ecranLogin = true;
    page.on('console', (m) => {
        if (m.type() !== 'error') return;
        if (ecranLogin && /401/.test(m.text())) return;
        errs.push(m.text());
    });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

    for (const [nom, hash, waitMs] of [
        ['login', '', 800],   // sans cookie ci-dessous pour cette seule capture
        ['carte', '#/map', 2500],
        ['journal', '#/feed', 1400],
        ['profil', '#/profile', 1400],
        ['capture', '#/capture', 1800],
        ['admin', '#/admin', 1000],
    ]) {
        await page.goto('about:blank');
        ecranLogin = nom === 'login';
        if (nom === 'login') await ctx.clearCookies();
        else await ctx.addCookies([{ name: 'beusauth', value: TOKEN, domain: new URL(BASE).hostname, path: '/', secure: true }]);
        await page.goto(`${BASE}/` + hash, { waitUntil: 'networkidle' });
        await page.waitForTimeout(waitMs);
        await page.screenshot({ path: `${OUT}/${nom}-${label}.png` });
    }
    await ctx.close();
    return errs;
}

let allErrs = [];
allErrs = allErrs.concat((await shoot(390, 844, 'iphone')).map((e) => 'iphone: ' + e));
allErrs = allErrs.concat((await shoot(1280, 800, 'desktop')).map((e) => 'desktop: ' + e));
await browser.close();

console.log(`Captures écrites dans ${OUT}/`);
if (allErrs.length) {
    console.log(`\n❌ ${allErrs.length} erreur(s) console pendant les captures :`);
    allErrs.forEach((e) => console.log('  ' + e));
    process.exit(1);
}
console.log('\n✅ aucune erreur console pendant les captures — vérifier les PNG visuellement.');
