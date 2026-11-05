// Rattrapage d'une journée manquée — le parcours complet, dans un vrai
// navigateur : Sam raconte un jour qu'Alex n'a pas rempli, Alex doit voir
// ce souvenir VERROUILLÉ *et*, sur la même journée, l'invitation à la combler.
//
// Le piège corrigé ici : un premier jet supprimait l'invitation dès qu'un
// souvenir existait pour ce jour-là. Or c'est justement le cas qui donne envie
// de publier — l'autre a raconté sa journée, elle est là, floutée.
//
//   PLAYWRIGHT_PATH=/tmp/node_modules/playwright/index.mjs \
//   TOKEN=… TOKEN_SAM=… node tests/rattrapage.mjs

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const f = await import(new URL('./fixtures.mjs', import.meta.url).pathname);
const BASE = process.env.BASE || 'https://beus-dev.example.com';
let fail = 0;
const t = (ok, l, x='') => { console.log(`  ${ok?'✅':'❌'} ${l}${x?' — '+x:''}`); if(!ok) fail++; };

// Sam remplit un jour ; Alex ne l'a pas -> il doit voir « combler ».
const [, j1] = f.joursRecents(2);
const ids = [];
{
    const form = new FormData();
    form.append('primary_photo', new Blob([f.pngUni(48,[200,90,70])],{type:'image/png'}), 'p.png');
    form.append('secondary_photo', new Blob([f.pngUni(48,[30,24,20])],{type:'image/png'}), 's.png');
    form.append('primary_facing','environment'); form.append('lat','48.8566'); form.append('lng','2.3522');
    form.append('caption','[test-auto] jour de Sam'); form.append('day', j1);
    const r = await fetch(`${BASE}/api/beus/posts`, {method:'POST', body:form,
        headers:{Cookie:`beusauth=${process.env.TOKEN_SAM}`}});
    const d = await r.json(); ids.push(d.id);
    console.log('  souvenir de Sam créé :', d.id, j1);
}

const b = await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const ctx = await b.newContext({viewport:{width:390,height:844}, permissions:['geolocation'],
    geolocation:{latitude:48.8566, longitude:2.3522}});
await ctx.addInitScript(() => { try { localStorage.setItem('beus:accueil:alex', '1'); localStorage.setItem('beus:accueil:sam', '1'); } catch {} }); // l'accueil (3 écrans, une fois par compte) masquerait l'app
await ctx.addCookies([{name:'beusauth', value:process.env.TOKEN, domain: new URL(BASE).hostname, path:'/', secure:true}]);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));

await page.goto(`${BASE}/#/feed`, {waitUntil:'networkidle'});
await page.waitForTimeout(2500);

const etat = await page.evaluate((j) => ({
    combler: document.querySelectorAll('[data-combler]').length,
    ceJour: !!document.querySelector(`[data-combler="${j}"]`),
    verrous: document.querySelectorAll('.slot.verrou').length,
}), j1);
t(etat.verrous === 1, 'le souvenir de Sam apparaît verrouillé', `${etat.verrous}`);
t(etat.ceJour, `une invitation à combler le ${j1}`, `${etat.combler} invitation(s)`);

if (etat.ceJour) {
    await page.click(`[data-combler="${j1}"]`);
    await page.waitForTimeout(2000);
    const cam = await page.evaluate(() => ({
        hash: location.hash,
        chip: document.getElementById('cam-jour')?.hidden === false
            ? document.getElementById('cam-jour').textContent : null,
    }));
    t(cam.hash === '#/capture', 'on arrive sur l’écran de capture', cam.hash);
    t(!!cam.chip, 'le jour visé est annoncé à l’écran', cam.chip || 'absent');
}
t(errs.length === 0, 'aucune erreur JS', errs.slice(0,2).join(' | '));
await b.close();
await f.nettoyer(process.env.TOKEN, ids, [process.env.TOKEN_SAM]);
const m = await (await fetch(`${BASE}/api/beus/posts/map`, {headers:{Cookie:`beusauth=${process.env.TOKEN}`}})).json();
t(m.posts.length === 0, 'données de test nettoyées', `${m.posts.length} restant(s)`);
console.log(fail ? `\n❌ ${fail} échec(s)` : '\n✅ le rattrapage fonctionne de bout en bout');
process.exit(fail?1:0);
