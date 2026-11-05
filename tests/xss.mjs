// Test de régression XSS du frontend.
// Règle : après esc(), il ne doit rester AUCUN caractère de balisage brut.
// Cible principale ici : les légendes (texte libre le plus exposé de l'app).
globalThis.window = { location: { origin: 'https://beus-dev.example.com' } };
const here = new URL('.', import.meta.url).pathname;
const { esc, safeUrl } = await import(here + '../frontend/assets/js/fmt.js');

let fail = 0;
const check = (ok, msg) => { console.log(`  ${ok ? '✅' : '❌ ÉCHEC'}  ${msg}`); if (!ok) fail++; };

console.log('--- esc() sur des légendes hostiles ---');
for (const p of ['<script>alert("XSS")</script>', '"><img src=x onerror=alert(1)>',
                 "'; alert(1); //", '</div><svg onload=alert(1)>', 'ça sent bon la mer & le soleil']) {
  const out = esc(p);
  const raw = /[<>"']/.test(out) || /&(?!(amp|lt|gt|quot|#39);)/.test(out);
  check(!raw, `${JSON.stringify(p).slice(0, 42).padEnd(44)} -> ${JSON.stringify(out).slice(0, 52)}`);
}

console.log('--- safeUrl() : seuls http(s) passent ---');
for (const [u, mustBlock] of [['javascript:alert(1)', true], ['data:text/html,<script>', true],
                              ['vbscript:msgbox', true], ['https://beus-dev.example.com/api/beus/photos/1/primary', false]]) {
  const out = safeUrl(u);
  check(mustBlock ? out === '#' : out.startsWith('https://'),
        `${u.slice(0, 40).padEnd(42)} -> ${out.slice(0, 40)}`);
}

console.log('--- attribut HTML : impossible de sortir des guillemets ---');
const attr = `data-post="${esc('1" onclick="alert(1)')}"`;
check(!/"\s*onclick/.test(attr), attr.slice(0, 62));

console.log('--- fil de commentaires : texte et nom hostiles ---');
globalThis.document = { getElementById: () => null, querySelector: () => null,
                        body: { classList: { toggle() {}, remove() {} } } };
const { comHtml } = await import(here + '../frontend/assets/js/ui.js');
const html = comHtml({ id: 7, author_id: 'sam"><svg onload=alert(1)>',
                       body: '<img src=x onerror=alert(1)>', created_at: '2026-09-23 10:00:00' },
                     'alex', esc);
check(!/<img/i.test(html) && !/<svg/i.test(html), 'ni <img> ni <svg> bruts dans le rendu');

console.log(fail ? `\n${fail} échec(s)` : '\nTous les tests XSS passent.');
process.exit(fail ? 1 : 0);
