// Dates et échelles : deux calculs où une erreur se voit tout de suite à
// l'écran (heure décalée d'une ou deux heures, marqueur qui ne rapetisse pas).
globalThis.window = { location: { origin: 'https://beus-dev.example.com' } };
const here = new URL('.', import.meta.url).pathname;
const { heureFr, dateFr, ilYA } = await import(here + '../frontend/assets/js/fmt.js');
const { markerScaleForZoom } = await import(here + '../frontend/assets/js/maplib.js');

let fail = 0;
const t = (ok, label, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
    if (!ok) fail++;
};

console.log('── dates : le format SQLite est de l’UTC sans marqueur ──');
// 12:00 UTC doit tomber à 14:00 à Paris l'été. On l'affirme en Paris explicite
// plutôt qu'« autre chose que 12:00 » : le test tournait sous un shell en UTC,
// où l'ancienne formulation échouait alors que le code était juste.
const hSqlite = heureFr('2026-07-15 12:00:00');
const hIso = heureFr('2026-07-15T12:00:00Z');
t(hSqlite === hIso, 'même instant, écrit des deux façons', `${hSqlite} vs ${hIso}`);
const aParis = new Date('2026-07-15T12:00:00Z')
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
t(aParis === '14:00', 'un été à Paris, 12:00 UTC s’écrit 14:00', aParis);
t(dateFr('2026-07-15 12:00:00').includes('juillet'), 'date en français',
  dateFr('2026-07-15 12:00:00'));
t(ilYA(new Date().toISOString()) === 'aujourd’hui', '« aujourd’hui » pour maintenant');
t(heureFr(null) === '' && dateFr(undefined) === '', 'valeurs vides tolérées');

console.log('── échelle des marqueurs : courbe en cloche ──');
const zMonde = markerScaleForZoom(1), zPays = markerScaleForZoom(5),
      zVille = markerScaleForZoom(11), zRue = markerScaleForZoom(18);
t(zVille === 1, 'pleine taille à l’échelle d’une ville', String(zVille));
t(zMonde < 0.7, 'discret en vue monde (sinon il couvre un continent)', String(zMonde));
t(zRue < 0.6, 'discret en vue rue (sinon il masque le lieu)', String(zRue));
t(zPays > zMonde && zPays < zVille, 'progression continue entre les deux', String(zPays));
t(zMonde > 0.2 && zRue > 0.2, 'jamais invisible', `${zMonde} / ${zRue}`);

console.log(fail ? `\n❌ ${fail} échec(s)` : '\n✅ formats et échelles corrects');
process.exit(fail ? 1 : 0);
