// Contrôle de débordement horizontal, de 320 à 1920 px — même méthode que
// job-radar/stockage : relire le CSS ne suffit pas, un débordement ne se voit
// qu'en page réelle.
//
//   cd /tmp && npm install playwright && npx playwright install chromium
//   PLAYWRIGHT_PATH=/tmp/node_modules/playwright/index.mjs \
//   TOKEN="$(docker exec beus-dev python3 -c "import security;print(security.create_token('alex',True))")" \
//   node tests/overflow.mjs
//
// playwright reste hors dépôt : il ne sert qu'à la vérification. BeUs est
// public (pas Tailscale) : on tape directement le domaine, cookie de test posé.

const BASE = process.env.BASE || 'https://beus-dev.example.com';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const b = await chromium.launch({ args: ['--ignore-certificate-errors'] });
let bad = 0;
for (const w of [320, 375, 390, 480, 768, 1024, 1440, 1920]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
  await ctx.addCookies([{ name: 'beusauth', value: process.env.TOKEN, domain: new URL(BASE).hostname, path: '/', secure: true }]);
  const p = await ctx.newPage();
  for (const [nom, h] of [['carte', '#/map'], ['journal', '#/feed'], ['profil', '#/profile'], ['admin', '#/admin']]) {
    await p.goto('about:blank');
    await p.goto(`${BASE}/` + h, { waitUntil: 'networkidle' });
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      coupables: [...document.querySelectorAll('*')]
        .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .slice(0, 3).map((e) => e.className || e.tagName),
    }));
    const ok = r.scroll <= r.client + 1;
    if (!ok) { bad++; console.log(`  ❌ ${w}px ${nom} : ${r.scroll} > ${r.client} — ${r.coupables.join(', ')}`); }
  }
  await ctx.close();
  console.log(`  ${w}px : ${bad ? 'voir ci-dessus' : 'aucun débordement'}`);
}
await b.close();
console.log(bad ? `\n❌ ${bad} débordement(s)` : '\n✅ aucun débordement horizontal, de 320 à 1920 px');
process.exit(bad ? 1 : 0);
