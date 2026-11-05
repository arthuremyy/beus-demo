// Client HTTP. Cookie beusauth systématique ; un 401 renvoie à l'écran de
// connexion PROPRE à BeUs (pas celui du dashboard — auth indépendante à 2 comptes).
const BASE = '/api/beus';
let onUnauthorized = () => { window.location.hash = '#/login'; };

export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(path, { method = 'GET', body, form } = {}) {
    const opts = { method, credentials: 'include', headers: {} };
    if (form) {
        opts.body = form; // laisser le navigateur poser le boundary multipart
    } else if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, opts);

    // Un code faux à la connexion est un 401 aussi : ce n'est pas une session
    // perdue, l'écran de connexion gère lui-même son message.
    if (res.status === 401 && path !== '/auth/login') {
        onUnauthorized();
        throw new Error('Non authentifié');
    }
    let data = null;
    try { data = await res.json(); } catch { /* réponse sans corps JSON (photo binaire) */ }
    if (!res.ok) {
        const err = new Error(data?.detail || data?.error || `Erreur HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

/** Envoi multipart avec progression (fetch ne la donne pas) : deux photos en
 *  4G prennent plusieurs secondes, l'écran doit montrer que ça avance.
 *  Une erreur réseau porte `horsLigne` : la publication sera relancée. */
function envoieAvecProgression(path, form, onProgress) {
    return new Promise((ok, ko) => {
        const x = new XMLHttpRequest();
        x.open('POST', BASE + path);
        x.withCredentials = true;
        x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
        x.onerror = () => {
            const err = new Error('Réseau indisponible');
            err.horsLigne = true;
            ko(err);
        };
        x.onload = () => {
            let data = null;
            try { data = JSON.parse(x.responseText); } catch { /* sans corps JSON */ }
            if (x.status === 401) { onUnauthorized(); ko(new Error('Non authentifié')); return; }
            if (x.status < 200 || x.status >= 300) {
                const err = new Error(data?.detail || `Erreur HTTP ${x.status}`);
                err.status = x.status; err.data = data;
                ko(err); return;
            }
            ok(data);
        };
        x.send(form);
    });
}

export const api = {
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    patch: (p, body) => request(p, { method: 'PATCH', body }),
    del: (p) => request(p, { method: 'DELETE' }),
    postForm: (p, form, onProgress) => (onProgress
        ? envoieAvecProgression(p, form, onProgress)
        : request(p, { method: 'POST', form })),
};
