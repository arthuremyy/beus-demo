// Visibilité des éléments d'habillage (barre du bas, bandeau de carte).
//
// Existe parce que le bug est apparu DEUX fois : une règle de base qui fixe un
// `display` (flex) l'emporte sur l'attribut `hidden` posé par le routeur, et
// la barre restait affichée sur l'écran de connexion, puis par-dessus le
// déclencheur de la caméra. On mesure donc le rendu réel, pas l'attribut.
//
//   PLAYWRIGHT_PATH=/tmp/node_modules/playwright/index.mjs \
//   TOKEN=… node tests/chrome.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE || 'https://beus-dev.example.com';
const HOTE = new URL(BASE).hostname;

const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
let fail = 0;
const t = (ok, label, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!ok) fail++;
};

async function etat(page) {
    return page.evaluate(() => {
        const vu = (id) => {
            const el = document.getElementById(id);
            if (!el) return false;
            const s = getComputedStyle(el);
            return s.display !== 'none' && s.visibility !== 'hidden'
                && el.getBoundingClientRect().height > 0;
        };
        return { nav: vu('nav'), hud: vu('map-hud') };
    });
}

// Écran de connexion : aucun habillage d'application.
{
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const e = await etat(page);
    console.log('── écran de connexion ──');
    t(!e.nav, 'barre de navigation cachée');
    t(!e.hud, 'bandeau de carte caché');
    await ctx.close();
}

// Connecté : chaque vue montre ce qu'il faut, et rien de plus.
{
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        permissions: ['geolocation'], geolocation: { latitude: 48.8566, longitude: 2.3522 },
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
    await ctx.addCookies([{ name: 'beusauth', value: process.env.TOKEN,
        domain: HOTE, path: '/', secure: true }]);
    const page = await ctx.newPage();

    // Profil et admin sont des écrans « poussés » depuis l'avatar, avec un
    // retour : pas de barre du bas.
    const attendu = {
        map:     { nav: true,  hud: true  },
        feed:    { nav: true,  hud: false },
        profile: { nav: false, hud: false },
        admin:   { nav: false, hud: false },
        capture: { nav: false, hud: false },
        review:  { nav: false, hud: false },
    };
    for (const [vue, att] of Object.entries(attendu)) {
        await page.goto('about:blank');
        await page.goto(`${BASE}/#/${vue}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1600);
        // Le bandeau ne s'affiche qu'une fois son message connu (il montait
        // vide pendant le chargement) : on lui laisse le temps d'arriver.
        if (att.hud) await page.waitForSelector('#map-hud:not([hidden])', { timeout: 8000 }).catch(() => {});
        const e = await etat(page);
        console.log(`── vue « ${vue} » ──`);
        for (const cle of ['nav', 'hud']) {
            t(e[cle] === att[cle], `${cle} ${att[cle] ? 'visible' : 'caché'}`,
              e[cle] === att[cle] ? '' : `obtenu ${e[cle] ? 'visible' : 'caché'}`);
        }
    }

    // Le déclencheur de capture doit être réellement cliquable : c'est la nav
    // qui le recouvrait, et un test d'attribut seul ne l'aurait pas vu.
    await page.goto('about:blank');
    await page.goto(`${BASE}/#/capture`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const capture = await page.evaluate(() => {
        // La journée déjà racontée couvre VOLONTAIREMENT l'écran de capture :
        // dans ce cas le déclencheur doit être inaccessible, c'est le but.
        const bloque = document.getElementById('cam-bloc')?.hidden === false;
        const b = document.getElementById('cam-shutter').getBoundingClientRect();
        const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { bloque, dessus: el ? (el.closest('#cam-bloc') ? 'cam-bloc' : (el.id || el.className)) : null };
    });
    console.log('── déclencheur de capture ──');
    if (capture.bloque) {
        t(capture.dessus === 'cam-bloc',
          'journée déjà racontée : le panneau couvre bien le déclencheur',
          `dessus : ${capture.dessus}`);
    } else {
        // Le vrai piège historique : la nav basse recouvrait le déclencheur.
        t(capture.dessus === 'cam-shutter', 'rien ne recouvre le déclencheur',
          `dessus : ${capture.dessus}`);
    }
    await ctx.close();
}

await browser.close();
console.log(fail ? `\n❌ ${fail} échec(s)` : '\n✅ habillage correct sur toutes les vues');
process.exit(fail ? 1 : 0);
